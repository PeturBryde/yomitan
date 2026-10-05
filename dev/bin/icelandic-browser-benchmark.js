/*
 * Copyright (C) 2026  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {execFileSync} from 'child_process';
import {createHash} from 'crypto';
import {
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'fs';
import JSZip from 'jszip';
import {homedir} from 'os';
import {fileURLToPath} from 'node:url';
import path from 'path';
import {chromium} from '@playwright/test';
import {parseJson} from '../json.js';
import {ManifestUtil} from '../manifest-util.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '..', '..');
const sourceExtensionDirectory = path.join(root, 'ext');

const stateVersion = 1;
const importPollMilliseconds = 2000;
const importProgressMilliseconds = 10000;

const icelandicImportLine =
    'import {icelandicTransforms} from \'./is/icelandic-transforms.js\';\n';
const icelandicDescriptorWithTransforms = [
    '    {',
    '        iso: \'is\',',
    '        iso639_3: \'isl\',',
    '        name: \'Icelandic\',',
    '        exampleText: \'lesa\',',
    '        textPreprocessors: capitalizationPreprocessors,',
    '        languageTransforms: icelandicTransforms,',
    '    },',
].join('\n');
const icelandicDescriptorWithoutTransforms = [
    '    {',
    '        iso: \'is\',',
    '        iso639_3: \'isl\',',
    '        name: \'Icelandic\',',
    '        exampleText: \'lesa\',',
    '        textPreprocessors: capitalizationPreprocessors,',
    '    },',
].join('\n');

/**
 * @typedef {'hybrid'|'explicit'} BenchmarkMode
 */

/**
 * @param {string[]} args
 * @returns {{command: string, options: Map<string, string[]>, flags: Set<string>}}
 * @throws {Error} If the command line is invalid.
 */
function parseArgs(args) {
    const command = args.shift();
    if (typeof command === 'undefined') {
        throw new Error('Expected a command: smoke, prepare-base, prepare-mode, or run.');
    }

    /** @type {Map<string, string[]>} */
    const options = new Map();
    /** @type {Set<string>} */
    const flags = new Set();

    for (let i = 0; i < args.length; ++i) {
        const option = args[i];
        if (!option.startsWith('--')) {
            throw new Error('Unexpected positional argument: ' + option);
        }
        if (option === '--reset') {
            flags.add(option);
            continue;
        }

        const value = args[++i];
        if (typeof value === 'undefined' || value.startsWith('--')) {
            throw new Error('Missing value for ' + option);
        }
        const values = options.get(option);
        if (typeof values === 'undefined') {
            options.set(option, [value]);
        } else {
            values.push(value);
        }
    }

    return {command, options, flags};
}

/**
 * @param {Map<string, string[]>} options
 * @param {string} name
 * @param {?string} [defaultValue]
 * @returns {string}
 * @throws {Error} If the option is missing or repeated.
 */
function getOption(options, name, defaultValue = null) {
    const values = options.get(name);
    if (typeof values === 'undefined') {
        if (defaultValue !== null) {
            return defaultValue;
        }
        throw new Error('Missing required option: ' + name);
    }
    if (values.length !== 1) {
        throw new Error(name + ' must be specified exactly once');
    }
    return values[0];
}

/**
 * @param {Map<string, string[]>} options
 * @param {string} name
 * @returns {string[]}
 */
function getOptions(options, name) {
    return options.get(name) ?? [];
}

/**
 * @param {string} value
 * @returns {BenchmarkMode}
 * @throws {Error} If the mode is unsupported.
 */
function getMode(value) {
    if (value !== 'hybrid' && value !== 'explicit') {
        throw new Error('Invalid mode: ' + value);
    }
    return value;
}

/**
 * @param {string} value
 * @param {string} name
 * @param {number} minimum
 * @returns {number}
 * @throws {Error} If the value is not an integer in range.
 */
function getInteger(value, name, minimum) {
    const result = Number.parseInt(value, 10);
    if (!Number.isInteger(result) || result < minimum) {
        throw new Error(name + ' must be an integer >= ' + minimum);
    }
    return result;
}

/**
 * @returns {string}
 */
function getSourceCommit() {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
    }).trim();
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function getSha256(filePath) {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * @param {string} directory
 * @returns {number}
 */
function getDirectorySize(directory) {
    let total = 0;
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            total += getDirectorySize(child);
        } else if (entry.isFile()) {
            total += statSync(child).size;
        }
    }
    return total;
}

/**
 * @param {string} filePath
 * @returns {unknown}
 */
function readJson(filePath) {
    return parseJson(readFileSync(filePath, {encoding: 'utf8'}));
}

/**
 * @param {string} filePath
 * @param {unknown} value
 */
function writeJson(filePath, value) {
    writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

/**
 * @param {string} workspace
 * @returns {{
 *   extension: string,
 *   extensionMarker: string,
 *   baseProfile: string,
 *   baseState: string,
 *   hybridProfile: string,
 *   hybridState: string,
 *   explicitProfile: string,
 *   explicitState: string
 * }}
 */
function getWorkspacePaths(workspace) {
    return {
        extension: path.join(workspace, 'extension'),
        extensionMarker: path.join(workspace, 'extension-source-commit.txt'),
        baseProfile: path.join(workspace, 'profile-base'),
        baseState: path.join(workspace, 'state-base.json'),
        hybridProfile: path.join(workspace, 'profile-hybrid'),
        hybridState: path.join(workspace, 'state-hybrid.json'),
        explicitProfile: path.join(workspace, 'profile-explicit'),
        explicitState: path.join(workspace, 'state-explicit.json'),
    };
}

/**
 * @param {ReturnType<typeof getWorkspacePaths>} paths
 * @param {BenchmarkMode} mode
 * @returns {{profile: string, state: string}}
 */
function getModePaths(paths, mode) {
    return (
        mode === 'hybrid' ?
        {profile: paths.hybridProfile, state: paths.hybridState} :
        {profile: paths.explicitProfile, state: paths.explicitState}
    );
}

/**
 * @param {string} profile
 */
function removeChromiumSingletonFiles(profile) {
    for (const name of ['SingletonCookie', 'SingletonLock', 'SingletonSocket']) {
        rmSync(path.join(profile, name), {recursive: true, force: true});
    }
}

/**
 * @param {string} sourceProfile
 * @param {string} targetProfile
 * @throws {Error} If the source profile does not exist.
 */
function cloneProfile(sourceProfile, targetProfile) {
    if (!existsSync(sourceProfile)) {
        throw new Error('Base profile does not exist: ' + sourceProfile);
    }
    rmSync(targetProfile, {recursive: true, force: true});
    cpSync(sourceProfile, targetProfile, {recursive: true});
    removeChromiumSingletonFiles(targetProfile);
}

/**
 * Keep one stable unpacked-extension path so Chromium assigns the same extension
 * ID to the base, hybrid, and explicit profiles. The full extension tree is
 * copied only when the checked-out source commit changes.
 * @param {string} extensionDirectory
 * @param {string} markerPath
 */
function ensureExtensionCopy(extensionDirectory, markerPath) {
    const commit = getSourceCommit();
    const marker = (
        existsSync(markerPath) ?
        readFileSync(markerPath, {encoding: 'utf8'}).trim() :
        ''
    );

    if (marker === commit && existsSync(extensionDirectory)) {
        return;
    }

    rmSync(extensionDirectory, {recursive: true, force: true});
    mkdirSync(path.dirname(extensionDirectory), {recursive: true});
    cpSync(sourceExtensionDirectory, extensionDirectory, {recursive: true});
    writeFileSync(markerPath, commit + '\n');
}

/**
 * @param {string} extensionDirectory
 * @param {BenchmarkMode} mode
 * @throws {Error} If the source extension does not have the expected layout.
 */
function setExtensionMode(extensionDirectory, mode) {
    const sourceDescriptors = path.join(
        sourceExtensionDirectory,
        'js',
        'language',
        'language-descriptors.js',
    );
    const targetDescriptors = path.join(
        extensionDirectory,
        'js',
        'language',
        'language-descriptors.js',
    );
    const sourceTransforms = path.join(
        sourceExtensionDirectory,
        'js',
        'language',
        'is',
        'icelandic-transforms.js',
    );
    const targetTransforms = path.join(
        extensionDirectory,
        'js',
        'language',
        'is',
        'icelandic-transforms.js',
    );

    let descriptors = readFileSync(sourceDescriptors, {encoding: 'utf8'});
    if (!descriptors.includes(icelandicDescriptorWithTransforms)) {
        throw new Error(
            'Could not find the expected Icelandic descriptor in language-descriptors.js.',
        );
    }

    if (mode === 'hybrid') {
        cpSync(sourceTransforms, targetTransforms);
    } else {
        if (!descriptors.includes(icelandicImportLine)) {
            throw new Error('Could not find the Icelandic transform import.');
        }
        descriptors = descriptors.replace(icelandicImportLine, '');
        descriptors = descriptors.replace(
            icelandicDescriptorWithTransforms,
            icelandicDescriptorWithoutTransforms,
        );
        rmSync(targetTransforms, {force: true});
    }

    writeFileSync(targetDescriptors, descriptors);

    const manifestUtil = new ManifestUtil();
    const manifest = manifestUtil.getManifest('chrome-playwright');
    writeFileSync(
        path.join(extensionDirectory, 'manifest.json'),
        ManifestUtil.createManifestString(manifest).replace(
            '$YOMITAN_VERSION',
            '0.0.0.0',
        ),
    );
}

/**
 * @param {string} extensionDirectory
 * @returns {number}
 */
function getIcelandicTransformBytes(extensionDirectory) {
    const filePath = path.join(
        extensionDirectory,
        'js',
        'language',
        'is',
        'icelandic-transforms.js',
    );
    return existsSync(filePath) ? statSync(filePath).size : 0;
}

/**
 * @param {string} profile
 * @param {string} extensionDirectory
 * @returns {Promise<import('playwright').BrowserContext>}
 */
async function launchContext(profile, extensionDirectory) {
    mkdirSync(profile, {recursive: true});
    return await chromium.launchPersistentContext(profile, {
        args: [
            '--headless=new',
            '--disable-extensions-except=' + extensionDirectory,
            '--load-extension=' + extensionDirectory,
        ],
    });
}

/**
 * @param {import('playwright').BrowserContext} context
 * @returns {Promise<string>}
 */
async function getExtensionId(context) {
    let [serviceWorker] = context.serviceWorkers();
    if (typeof serviceWorker === 'undefined') {
        serviceWorker = await context.waitForEvent('serviceworker');
    }
    const extensionId = serviceWorker.url().split('/')[2];
    if (!extensionId) {
        throw new Error(
            'Could not determine extension ID from ' + serviceWorker.url(),
        );
    }
    return extensionId;
}

/**
 * @param {import('playwright').BrowserContext} context
 * @returns {Promise<{page: import('playwright').Page, extensionId: string}>}
 */
async function openSettings(context) {
    const extensionId = await getExtensionId(context);
    const page = await context.newPage();
    await page.goto(
        'chrome-extension://' + extensionId + '/settings.html',
    );
    await page.waitForFunction(
        () => document.documentElement.dataset.loaded === 'true',
        void 0,
        {timeout: 60000},
    );
    return {page, extensionId};
}

/**
 * @param {import('playwright').Page} page
 * @param {string} action
 * @param {unknown} params
 * @returns {Promise<unknown>}
 */
async function sendApiMessage(page, action, params) {
    return await page.evaluate(
        async ({action: action2, params: params2}) => {
            const response = await /** @type {Promise<unknown>} */ (new Promise((resolve, reject) => {
                globalThis.chrome.runtime.sendMessage(
                    {action: action2, params: params2},
                    (/** @type {unknown} */ value) => {
                        const error = globalThis.chrome.runtime.lastError;
                        if (typeof error !== 'undefined') {
                            reject(new Error(error.message));
                        } else {
                            resolve(value);
                        }
                    },
                );
            }));

            if (
                typeof response !== 'object' ||
                response === null
            ) {
                throw new Error(
                    'Unexpected extension API response: ' +
                    JSON.stringify(response),
                );
            }
            if ('error' in response && typeof response.error !== 'undefined') {
                throw new Error(
                    'Extension API error: ' + JSON.stringify(response.error),
                );
            }
            if (!('result' in response)) {
                throw new Error(
                    'Extension API response has no result: ' +
                    JSON.stringify(response),
                );
            }
            return response.result;
        },
        {action, params},
    );
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<import('dictionary-importer').Summary[]>}
 */
async function getDictionaryInfo(page) {
    return /** @type {import('dictionary-importer').Summary[]} */ (
        await sendApiMessage(page, 'getDictionaryInfo', void 0)
    );
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<{usage?: number, quota?: number}>}
 */
async function getStorageEstimate(page) {
    return await page.evaluate(
        async () => await globalThis.navigator.storage.estimate(),
    );
}

/**
 * @param {string} dictionaryPath
 * @returns {Promise<{
 *   path: string,
 *   title: string,
 *   revision: string,
 *   sha256: string,
 *   bytes: number
 * }>}
 */
async function describeDictionary(dictionaryPath) {
    const resolved = path.resolve(dictionaryPath);
    if (!existsSync(resolved)) {
        throw new Error('Dictionary does not exist: ' + resolved);
    }

    const zip = await JSZip.loadAsync(readFileSync(resolved));
    const indexFile = zip.file('index.json');
    if (indexFile === null) {
        throw new Error('Dictionary has no index.json: ' + resolved);
    }
    const index = parseJson(await indexFile.async('text'));
    if (
        typeof index !== 'object' ||
        index === null ||
        !('title' in index) ||
        typeof index.title !== 'string' ||
        !('revision' in index) ||
        typeof index.revision !== 'string'
    ) {
        throw new Error('Dictionary index lacks title/revision: ' + resolved);
    }

    return {
        path: resolved,
        title: index.title,
        revision: index.revision,
        sha256: getSha256(resolved),
        bytes: statSync(resolved).size,
    };
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @returns {boolean}
 */
function jsonEqual(actual, expected) {
    return JSON.stringify(actual) === JSON.stringify(expected);
}

/**
 * @param {unknown} state
 * @param {string} kind
 * @param {unknown} lexical
 * @param {unknown} morphology
 * @throws {Error} If the stored benchmark identity does not match.
 */
function verifyStateIdentity(state, kind, lexical, morphology) {
    if (typeof state !== 'object' || state === null) {
        throw new Error('Benchmark state is malformed.');
    }
    const value = /** @type {Record<string, unknown>} */ (state);
    if (value.stateVersion !== stateVersion || value.kind !== kind) {
        throw new Error('Benchmark state version/kind mismatch.');
    }
    if (!jsonEqual(value.lexical, lexical)) {
        throw new Error(
            'Persistent profile uses a different lexical artifact. ' +
            'Refusing to reimport automatically.',
        );
    }
    if (!jsonEqual(value.morphology ?? null, morphology ?? null)) {
        throw new Error(
            'Persistent profile uses a different morphology artifact. ' +
            'Refusing to reimport automatically.',
        );
    }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} title
 * @param {number} timeoutMilliseconds
 * @returns {Promise<import('dictionary-importer').Summary>}
 */
async function waitForSuccessfulImport(page, title, timeoutMilliseconds) {
    const started = Date.now();
    let lastProgress = started;

    while (Date.now() - started < timeoutMilliseconds) {
        const dictionaries = await getDictionaryInfo(page);
        const dictionary = dictionaries.find((item) => item.title === title);
        if (typeof dictionary !== 'undefined') {
            if (dictionary.importSuccess === true) {
                return dictionary;
            }
            if (dictionary.importSuccess === false) {
                // During a normal import the summary is created before all term
                // records are inserted, so keep waiting. A failed/interrupted
                // import is detected by the timeout or on the next prepare run.
            }
        }

        const now = Date.now();
        if (now - lastProgress >= importProgressMilliseconds) {
            const progressInfo = (
                await page.locator(
                    '.dictionary-import-progress .progress-info',
                ).first().textContent()
                    .catch(() => null)
            )?.trim();
            const progressStatus = (
                await page.locator(
                    '.dictionary-import-progress .progress-status',
                ).first().textContent()
                    .catch(() => null)
            )?.trim();
            const progress = [progressInfo, progressStatus]
                .filter(Boolean)
                .join(' ');
            console.log(
                '  still importing ' + JSON.stringify(title) +
                ' (' + ((now - started) / 1000).toFixed(1) + ' s elapsed)' +
                (progress ? ': ' + progress : ''),
            );
            lastProgress = now;
        }

        const errorNode = page.locator('#dictionary-error');
        if (await errorNode.isVisible().catch(() => false)) {
            const errorText = (await errorNode.textContent())?.trim();
            if (errorText) {
                throw new Error('Dictionary import failed: ' + errorText);
            }
        }

        await page.waitForTimeout(importPollMilliseconds);
    }

    throw new Error(
        'Timed out importing ' + JSON.stringify(title) +
        ' after ' + (timeoutMilliseconds / 60000) + ' minutes.',
    );
}

/**
 * @param {import('playwright').Page} page
 * @param {{path: string, title: string}} dictionary
 * @param {number} timeoutMilliseconds
 * @returns {Promise<{summary: import('dictionary-importer').Summary, seconds: number}>}
 */
async function importDictionary(page, dictionary, timeoutMilliseconds) {
    console.log(
        'Importing ' + path.basename(dictionary.path) +
        ' as ' + JSON.stringify(dictionary.title) + '...',
    );
    const started = process.hrtime.bigint();
    await page.locator('#dictionary-import-file-input').setInputFiles(
        dictionary.path,
    );
    const summary = await waitForSuccessfulImport(
        page,
        dictionary.title,
        timeoutMilliseconds,
    );
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    console.log('  finished in ' + seconds.toFixed(3) + ' s');
    return {summary, seconds};
}

/**
 * @param {import('playwright').Page} page
 * @param {string[]} expectedTitles
 * @param {string} mainDictionary
 */
async function configureProfile(page, expectedTitles, mainDictionary) {
    const options = /** @type {import('settings').ProfileOptions} */ (
        await sendApiMessage(
            page,
            'optionsGet',
            {optionsContext: {current: true}},
        )
    );

    const expected = new Set(expectedTitles);
    const actual = new Set(options.dictionaries.map(({name}) => name));
    if (
        actual.size !== expected.size ||
        [...actual].some((name) => !expected.has(name))
    ) {
        throw new Error(
            'Unexpected dictionary settings. Expected ' +
            JSON.stringify([...expected]) + ', found ' +
            JSON.stringify([...actual]) + '.',
        );
    }

    /** @type {import('../../types/ext/settings-modifications').ScopedModification[]} */
    const targets = [
        {
            action: 'set',
            path: 'general.language',
            value: 'is',
            scope: 'profile',
            optionsContext: {current: true},
        },
        {
            action: 'set',
            path: 'general.mainDictionary',
            value: mainDictionary,
            scope: 'profile',
            optionsContext: {current: true},
        },
        {
            action: 'set',
            path: 'general.resultOutputMode',
            value: 'group',
            scope: 'profile',
            optionsContext: {current: true},
        },
        {
            action: 'set',
            path: 'general.maxResults',
            value: 32,
            scope: 'profile',
            optionsContext: {current: true},
        },
        {
            action: 'set',
            path: 'scanning.alphanumeric',
            value: true,
            scope: 'profile',
            optionsContext: {current: true},
        },
        {
            action: 'set',
            path: 'translation.searchResolution',
            value: 'word',
            scope: 'profile',
            optionsContext: {current: true},
        },
    ];

    for (const [index, dictionary] of options.dictionaries.entries()) {
        targets.push(
            {
                action: 'set',
                path: 'dictionaries[' + index + '].enabled',
                value: expected.has(dictionary.name),
                scope: 'profile',
                optionsContext: {current: true},
            },
            {
                action: 'set',
                path: 'dictionaries[' + index + '].partsOfSpeechFilter',
                value: true,
                scope: 'profile',
                optionsContext: {current: true},
            },
            {
                action: 'set',
                path: 'dictionaries[' + index + '].useDeinflections',
                value: true,
                scope: 'profile',
                optionsContext: {current: true},
            },
        );
    }

    const results = /** @type {import('core').Response<unknown>[]} */ (
        await sendApiMessage(
            page,
            'modifySettings',
            {
                targets,
                source: 'yomitan-isl-browser-benchmark',
            },
        )
    );
    const failures = results.filter(
        (result) => typeof result.error !== 'undefined',
    );
    if (failures.length > 0) {
        throw new Error(
            'Failed to configure benchmark profile: ' +
            JSON.stringify(failures),
        );
    }
}

/**
 * @param {import('playwright').Page} page
 * @param {string[]} expectedTitles
 */
async function verifyInstalledDictionaries(page, expectedTitles) {
    const dictionaries = await getDictionaryInfo(page);
    const expected = new Set(expectedTitles);
    const actual = new Set(dictionaries.map(({title}) => title));
    if (
        actual.size !== expected.size ||
        [...actual].some((title) => !expected.has(title))
    ) {
        throw new Error(
            'Unexpected installed dictionaries. Expected ' +
            JSON.stringify([...expected]) + ', found ' +
            JSON.stringify([...actual]) + '.',
        );
    }
    for (const dictionary of dictionaries) {
        if (dictionary.importSuccess !== true) {
            throw new Error(
                'Dictionary is present but not successfully imported: ' +
                JSON.stringify(dictionary.title),
            );
        }
    }
}

/**
 * @param {string} workspace
 * @param {string} lexicalPath
 * @param {boolean} reset
 * @param {number} importTimeoutMinutes
 */
async function prepareBase(
    workspace,
    lexicalPath,
    reset,
    importTimeoutMinutes,
) {
    const paths = getWorkspacePaths(workspace);
    const lexical = await describeDictionary(lexicalPath);
    const lexicalIdentity = {
        title: lexical.title,
        revision: lexical.revision,
        sha256: lexical.sha256,
        bytes: lexical.bytes,
    };

    if (reset) {
        console.log(
            'Resetting base and derived benchmark profiles by explicit request.',
        );
        for (const target of [
            paths.baseProfile,
            paths.hybridProfile,
            paths.explicitProfile,
        ]) {
            rmSync(target, {recursive: true, force: true});
        }
        for (const target of [
            paths.baseState,
            paths.hybridState,
            paths.explicitState,
        ]) {
            rmSync(target, {force: true});
        }
    }

    let state = (
        existsSync(paths.baseState) ?
        readJson(paths.baseState) :
        null
    );
    const stateWasReady = (
        typeof state === 'object' &&
        state !== null &&
        'status' in state &&
        state.status === 'ready'
    );

    if (state !== null) {
        verifyStateIdentity(state, 'base', lexicalIdentity, null);
    } else {
        if (
            existsSync(paths.baseProfile) &&
            readdirSync(paths.baseProfile).length > 0
        ) {
            throw new Error(
                'Base profile exists without state. Refusing to modify it. ' +
                'Use prepare-base --reset only if discarding it is intentional.',
            );
        }
        state = {
            stateVersion,
            kind: 'base',
            lexical: lexicalIdentity,
            morphology: null,
            status: 'preparing',
            sourceCommit: getSourceCommit(),
            createdAt: new Date().toISOString(),
        };
        mkdirSync(workspace, {recursive: true});
        writeJson(paths.baseState, state);
    }

    ensureExtensionCopy(paths.extension, paths.extensionMarker);
    setExtensionMode(paths.extension, 'hybrid');

    const context = await launchContext(paths.baseProfile, paths.extension);
    try {
        const {page, extensionId} = await openSettings(context);
        const dictionaries = await getDictionaryInfo(page);
        const unexpected = dictionaries.filter(
            ({title}) => title !== lexical.title,
        );
        if (unexpected.length > 0) {
            throw new Error(
                'Base profile has unexpected dictionaries: ' +
                JSON.stringify(unexpected.map(({title}) => title)),
            );
        }

        let summary = dictionaries.find(({title}) => title === lexical.title);
        let importSeconds = (
            typeof state === 'object' &&
            state !== null &&
            'importSeconds' in state ?
            state.importSeconds :
            null
        );

        if (typeof summary === 'undefined') {
            if (stateWasReady) {
                throw new Error(
                    'Base state says the lexical dictionary is already imported, ' +
                    'but Chromium cannot find it. Refusing to repeat the expensive ' +
                    'import automatically. Inspect the isolated benchmark profile ' +
                    'before using --reset.',
                );
            }
            const imported = await importDictionary(
                page,
                lexical,
                importTimeoutMinutes * 60 * 1000,
            );
            summary = imported.summary;
            importSeconds = imported.seconds;
        } else if (summary.importSuccess !== true) {
            throw new Error(
                'Base lexical dictionary is partially imported. ' +
                'Rerun prepare-base with --reset to rebuild the isolated base profile.',
            );
        } else {
            console.log(
                'Reusing already-imported ' + JSON.stringify(lexical.title) + '.',
            );
        }

        await verifyInstalledDictionaries(page, [lexical.title]);
        await configureProfile(page, [lexical.title], lexical.title);

        const storage = await getStorageEstimate(page);
        state = {
            stateVersion,
            kind: 'base',
            lexical: lexicalIdentity,
            morphology: null,
            status: 'ready',
            sourceCommit: getSourceCommit(),
            extensionId,
            dictionarySummary: summary,
            importSeconds,
            storage,
            updatedAt: new Date().toISOString(),
        };
        writeJson(paths.baseState, state);

        console.log('Persistent base profile is ready.');
        console.log('  lexical SHA-256: ' + lexical.sha256);
        console.log('  extension ID: ' + extensionId);
        console.log('  storage: ' + JSON.stringify(storage));
    } finally {
        await context.close();
    }
}

/**
 * @param {string} workspace
 * @param {BenchmarkMode} mode
 * @param {string} morphologyPath
 * @param {boolean} reset
 * @param {number} importTimeoutMinutes
 */
async function prepareMode(
    workspace,
    mode,
    morphologyPath,
    reset,
    importTimeoutMinutes,
) {
    const paths = getWorkspacePaths(workspace);
    if (!existsSync(paths.baseState)) {
        throw new Error('Base profile is not prepared. Run prepare-base first.');
    }

    const baseState = /** @type {Record<string, unknown>} */ (
        readJson(paths.baseState)
    );
    if (baseState.status !== 'ready') {
        throw new Error('Base profile state is not ready.');
    }
    const lexical = baseState.lexical;

    const morphology = await describeDictionary(morphologyPath);
    const morphologyIdentity = {
        title: morphology.title,
        revision: morphology.revision,
        sha256: morphology.sha256,
        bytes: morphology.bytes,
    };

    if (
        typeof lexical !== 'object' ||
        lexical === null ||
        !('title' in lexical) ||
        typeof lexical.title !== 'string'
    ) {
        throw new Error('Base lexical state is malformed.');
    }
    if (lexical.title === morphology.title) {
        throw new Error(
            'Lexical and morphology dictionary titles must differ.',
        );
    }

    const modePaths = getModePaths(paths, mode);
    if (reset) {
        console.log(
            'Resetting isolated ' + mode + ' benchmark profile by explicit request.',
        );
        rmSync(modePaths.profile, {recursive: true, force: true});
        rmSync(modePaths.state, {force: true});
    }

    let state = (
        existsSync(modePaths.state) ?
        readJson(modePaths.state) :
        null
    );
    const stateWasReady = (
        typeof state === 'object' &&
        state !== null &&
        'status' in state &&
        state.status === 'ready'
    );

    if (state !== null) {
        verifyStateIdentity(
            state,
            mode,
            lexical,
            morphologyIdentity,
        );
    } else {
        if (
            existsSync(modePaths.profile) &&
            readdirSync(modePaths.profile).length > 0
        ) {
            throw new Error(
                mode + ' profile exists without state. Refusing to modify it. ' +
                'Use prepare-mode --reset only if discarding the isolated clone is intentional.',
            );
        }
        cloneProfile(paths.baseProfile, modePaths.profile);
        state = {
            stateVersion,
            kind: mode,
            lexical,
            morphology: morphologyIdentity,
            status: 'preparing',
            sourceCommit: getSourceCommit(),
            createdAt: new Date().toISOString(),
        };
        writeJson(modePaths.state, state);
    }

    ensureExtensionCopy(paths.extension, paths.extensionMarker);
    setExtensionMode(paths.extension, mode);

    const context = await launchContext(modePaths.profile, paths.extension);
    try {
        const {page, extensionId} = await openSettings(context);
        if (
            typeof baseState.extensionId === 'string' &&
            extensionId !== baseState.extensionId
        ) {
            throw new Error(
                'Extension ID changed after cloning the base profile: ' +
                baseState.extensionId + ' -> ' + extensionId +
                '. Refusing to import morphology.',
            );
        }

        const expectedTitles = [lexical.title, morphology.title];
        let dictionaries = await getDictionaryInfo(page);
        const unexpected = dictionaries.filter(
            ({title}) => !expectedTitles.includes(title),
        );
        if (unexpected.length > 0) {
            throw new Error(
                mode + ' profile has unexpected dictionaries: ' +
                JSON.stringify(unexpected.map(({title}) => title)),
            );
        }

        const lexicalSummary = dictionaries.find(
            ({title}) => title === lexical.title,
        );
        if (
            typeof lexicalSummary === 'undefined' ||
            lexicalSummary.importSuccess !== true
        ) {
            throw new Error(
                'Cloned ' + mode +
                ' profile did not preserve the base lexical dictionary.',
            );
        }

        let morphologySummary = dictionaries.find(
            ({title}) => title === morphology.title,
        );
        let importSeconds = (
            typeof state === 'object' &&
            state !== null &&
            'importSeconds' in state ?
            state.importSeconds :
            null
        );

        if (typeof morphologySummary === 'undefined') {
            if (stateWasReady) {
                throw new Error(
                    'The ' + mode + ' state says the morphology dictionary is ' +
                    'already imported, but Chromium cannot find it. Refusing to ' +
                    'repeat the expensive import automatically. Inspect the ' +
                    'isolated benchmark profile before using --reset.',
                );
            }
            const imported = await importDictionary(
                page,
                morphology,
                importTimeoutMinutes * 60 * 1000,
            );
            morphologySummary = imported.summary;
            importSeconds = imported.seconds;
        } else if (morphologySummary.importSuccess !== true) {
            throw new Error(
                'Morphology dictionary is partially imported in the isolated ' +
                mode + ' profile. Rerun prepare-mode with --reset; this only ' +
                're-clones the already-prepared base profile and does not ' +
                'reimport the lexical dictionary.',
            );
        } else {
            console.log(
                'Reusing already-imported ' +
                JSON.stringify(morphology.title) + '.',
            );
        }

        dictionaries = await getDictionaryInfo(page);
        await verifyInstalledDictionaries(page, expectedTitles);
        await configureProfile(page, expectedTitles, lexical.title);

        const storage = await getStorageEstimate(page);
        const baseUsage = (
            typeof baseState.storage === 'object' &&
            baseState.storage !== null &&
            'usage' in baseState.storage &&
            typeof baseState.storage.usage === 'number' ?
            baseState.storage.usage :
            null
        );
        const morphologyUsageDelta = (
            baseUsage !== null &&
            typeof storage.usage === 'number' ?
            storage.usage - baseUsage :
            null
        );

        const transformModuleBytes = getIcelandicTransformBytes(
            paths.extension,
        );
        state = {
            stateVersion,
            kind: mode,
            lexical,
            morphology: morphologyIdentity,
            status: 'ready',
            sourceCommit: getSourceCommit(),
            extensionId,
            dictionarySummaries: dictionaries,
            importSeconds,
            storage,
            baseStorage: baseState.storage,
            morphologyUsageDelta,
            transformModuleBytes,
            updatedAt: new Date().toISOString(),
        };
        writeJson(modePaths.state, state);

        console.log('Persistent ' + mode + ' profile is ready.');
        console.log('  morphology SHA-256: ' + morphology.sha256);
        console.log(
            '  morphology import seconds: ' + String(importSeconds),
        );
        console.log('  storage: ' + JSON.stringify(storage));
        console.log(
            '  storage delta from lexical-only base: ' +
            morphologyUsageDelta,
        );
        console.log(
            '  Icelandic transform module bytes: ' +
            transformModuleBytes,
        );
    } finally {
        await context.close();
    }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} query
 * @returns {Promise<{
 *   milliseconds: number,
 *   count: number,
 *   entries: unknown[]
 * }>}
 */
async function termsFind(page, query) {
    return await page.evaluate(
        async ({query: query2}) => {
            const started = globalThis.performance.now();
            const response = await /** @type {Promise<unknown>} */ (new Promise((resolve, reject) => {
                globalThis.chrome.runtime.sendMessage(
                    {
                        action: 'termsFind',
                        params: {
                            text: query2,
                            details: {},
                            optionsContext: {current: true},
                        },
                    },
                    (/** @type {unknown} */ value) => {
                        const error = globalThis.chrome.runtime.lastError;
                        if (typeof error !== 'undefined') {
                            reject(new Error(error.message));
                        } else {
                            resolve(value);
                        }
                    },
                );
            }));
            const milliseconds = globalThis.performance.now() - started;

            if (
                typeof response !== 'object' ||
                response === null ||
                !('result' in response) ||
                ('error' in response && typeof response.error !== 'undefined')
            ) {
                throw new Error(
                    'termsFind failed: ' + JSON.stringify(response),
                );
            }

            const result = response.result;
            const rawEntries = (
                typeof result === 'object' &&
                result !== null &&
                'dictionaryEntries' in result &&
                Array.isArray(result.dictionaryEntries) ?
                /** @type {unknown[]} */ (result.dictionaryEntries) :
                []
            );

            const entries = rawEntries.map((entry) => {
                const entryObject = (
                    typeof entry === 'object' && entry !== null ?
                    /** @type {Record<string, unknown>} */ (entry) :
                    {}
                );
                const rawHeadwords = (
                    Array.isArray(entryObject.headwords) ?
                    /** @type {unknown[]} */ (entryObject.headwords) :
                    []
                );
                const headwords = rawHeadwords.map((headword) => {
                    const headwordObject = (
                        typeof headword === 'object' && headword !== null ?
                        /** @type {Record<string, unknown>} */ (headword) :
                        {}
                    );
                    const rawWordClasses = (
                        Array.isArray(headwordObject.wordClasses) ?
                        /** @type {unknown[]} */ (headwordObject.wordClasses) :
                        []
                    );
                    return {
                        term: (
                            typeof headwordObject.term === 'string' ?
                            headwordObject.term :
                            ''
                        ),
                        wordClasses: rawWordClasses.filter(
                            (value) => typeof value === 'string',
                        ),
                    };
                });

                const rawCandidates = (
                    Array.isArray(entryObject.inflectionRuleChainCandidates) ?
                    /** @type {unknown[]} */ (
                        entryObject.inflectionRuleChainCandidates
                    ) :
                    []
                );
                const inflections = rawCandidates.map((candidate) => {
                    const candidateObject = (
                        typeof candidate === 'object' && candidate !== null ?
                        /** @type {Record<string, unknown>} */ (candidate) :
                        {}
                    );
                    const rawRules = (
                        Array.isArray(candidateObject.inflectionRules) ?
                        /** @type {unknown[]} */ (
                            candidateObject.inflectionRules
                        ) :
                        []
                    );
                    const names = rawRules.map((rule) => {
                        const ruleObject = (
                            typeof rule === 'object' && rule !== null ?
                            /** @type {Record<string, unknown>} */ (rule) :
                            {}
                        );
                        return (
                            typeof ruleObject.name === 'string' ?
                            ruleObject.name :
                            ''
                        );
                    }).filter(Boolean);

                    return {
                        source: (
                            typeof candidateObject.source === 'string' ?
                            candidateObject.source :
                            ''
                        ),
                        names,
                    };
                });

                return {headwords, inflections};
            });

            return {
                milliseconds,
                count: entries.length,
                entries,
            };
        },
        {query},
    );
}

/**
 * @param {number[]} values
 * @param {number} fraction
 * @returns {number}
 */
function percentile(values, fraction) {
    if (values.length === 0) {
        return Number.NaN;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.max(
        0,
        Math.ceil(fraction * sorted.length) - 1,
    );
    return sorted[index];
}

/**
 * @param {number[]} values
 * @returns {{
 *   count: number,
 *   p50: number,
 *   p95: number,
 *   p99: number,
 *   max: number
 * }}
 */
function summarize(values) {
    return {
        count: values.length,
        p50: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        p99: percentile(values, 0.99),
        max: values.length > 0 ? Math.max(...values) : Number.NaN,
    };
}

/**
 * @param {string} filePath
 * @returns {string[]}
 */
function readQueries(filePath) {
    return readFileSync(path.resolve(filePath), {encoding: 'utf8'})
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(
            (line) => line.length > 0 && !line.startsWith('#'),
        );
}

/**
 * @param {string} workspace
 * @param {BenchmarkMode} mode
 * @param {string[]} queries
 * @param {number} warmupPasses
 * @param {number} repetitions
 * @param {number} processRuns
 * @param {?string} outputPath
 */
async function runBenchmark(
    workspace,
    mode,
    queries,
    warmupPasses,
    repetitions,
    processRuns,
    outputPath,
) {
    if (queries.length === 0) {
        throw new Error('At least one query is required.');
    }

    const paths = getWorkspacePaths(workspace);
    const modePaths = getModePaths(paths, mode);
    if (!existsSync(modePaths.state)) {
        throw new Error(
            'Persistent ' + mode +
            ' profile is not prepared. Run prepare-mode first.',
        );
    }

    const state = /** @type {Record<string, unknown>} */ (
        readJson(modePaths.state)
    );
    if (state.status !== 'ready') {
        throw new Error(mode + ' profile state is not ready.');
    }

    if (
        typeof state.lexical !== 'object' ||
        state.lexical === null ||
        !('title' in state.lexical) ||
        typeof state.lexical.title !== 'string' ||
        typeof state.morphology !== 'object' ||
        state.morphology === null ||
        !('title' in state.morphology) ||
        typeof state.morphology.title !== 'string'
    ) {
        throw new Error(mode + ' benchmark state is malformed.');
    }

    const lexicalTitle = state.lexical.title;
    const morphologyTitle = state.morphology.title;

    ensureExtensionCopy(paths.extension, paths.extensionMarker);
    setExtensionMode(paths.extension, mode);

    /** @type {unknown[]} */
    const processResults = [];
    /** @type {number[]} */
    const steadyTimes = [];

    for (
        let processIndex = 0;
        processIndex < processRuns;
        ++processIndex
    ) {
        console.log(
            'Process ' + (processIndex + 1) + '/' + processRuns +
            ' (' + mode + ')',
        );
        const context = await launchContext(
            modePaths.profile,
            paths.extension,
        );
        try {
            const {page, extensionId} = await openSettings(context);
            if (
                typeof state.extensionId === 'string' &&
                extensionId !== state.extensionId
            ) {
                throw new Error(
                    'Extension ID changed for persistent ' + mode +
                    ' profile.',
                );
            }

            await verifyInstalledDictionaries(
                page,
                [lexicalTitle, morphologyTitle],
            );
            await configureProfile(
                page,
                [lexicalTitle, morphologyTitle],
                lexicalTitle,
            );

            const cold = await termsFind(page, queries[0]);
            console.log(
                '  first lookup ' + JSON.stringify(queries[0]) +
                ': ' + cold.milliseconds.toFixed(3) + ' ms',
            );

            for (
                let warmup = 0;
                warmup < warmupPasses;
                ++warmup
            ) {
                for (const query of queries) {
                    await termsFind(page, query);
                }
            }

            /** @type {Record<string, {milliseconds: number[], sample: unknown|null}>} */
            const queryResults = {};
            for (const query of queries) {
                queryResults[query] = {
                    milliseconds: [],
                    sample: null,
                };
            }

            for (
                let repetition = 0;
                repetition < repetitions;
                ++repetition
            ) {
                for (const query of queries) {
                    const result = await termsFind(page, query);
                    queryResults[query].milliseconds.push(
                        result.milliseconds,
                    );
                    steadyTimes.push(result.milliseconds);
                    if (queryResults[query].sample === null) {
                        queryResults[query].sample = result;
                    }
                }
            }

            processResults.push({
                processIndex,
                cold,
                queryResults,
                storage: await getStorageEstimate(page),
            });
        } finally {
            await context.close();
        }
    }

    const report = {
        reportVersion: 1,
        mode,
        sourceCommit: getSourceCommit(),
        state,
        queries,
        warmupPasses,
        repetitions,
        processRuns,
        processResults,
        steadySummary: summarize(steadyTimes),
        profileDirectoryBytes: getDirectorySize(modePaths.profile),
        createdAt: new Date().toISOString(),
    };

    const output = (
        outputPath === null ?
        path.join(
            workspace,
            'benchmark-' + mode + '-' +
            new Date().toISOString().replaceAll(':', '-') +
            '.json',
        ) :
        path.resolve(outputPath)
    );
    writeJson(output, report);

    console.log(
        'Steady-state summary: ' +
        JSON.stringify(report.steadySummary),
    );
    console.log('Wrote ' + output);
}

/**
 * Verify cheaply that:
 * 1. a dictionary survives Chromium shutdown/restart;
 * 2. cloning a closed persistent profile preserves IndexedDB;
 * 3. switching the stable unpacked extension path from hybrid to explicit
 *    keeps the same extension ID and preserves the cloned dictionary.
 * @param {string} workspace
 */
async function smoke(workspace) {
    const smokeWorkspace = path.join(workspace, 'smoke');
    const paths = getWorkspacePaths(smokeWorkspace);
    const dictionaryPath = path.join(
        smokeWorkspace,
        'smoke-lexical.zip',
    );

    rmSync(smokeWorkspace, {recursive: true, force: true});
    mkdirSync(smokeWorkspace, {recursive: true});

    const zip = new JSZip();
    zip.file(
        'index.json',
        JSON.stringify({
            title: 'Yomitan-ISL benchmark smoke lexical',
            format: 3,
            revision: '1',
            sequenced: false,
            sourceLanguage: 'is',
            targetLanguage: 'en',
        }),
    );
    zip.file(
        'term_bank_1.json',
        JSON.stringify([
            ['verja', '', '', 'verb', 0, ['smoke definition'], 0, ''],
        ]),
    );
    writeFileSync(
        dictionaryPath,
        await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
        }),
    );

    ensureExtensionCopy(paths.extension, paths.extensionMarker);
    setExtensionMode(paths.extension, 'hybrid');

    let extensionId;
    let context = await launchContext(
        paths.baseProfile,
        paths.extension,
    );
    try {
        const opened = await openSettings(context);
        extensionId = opened.extensionId;
        const dictionary = await describeDictionary(dictionaryPath);
        await importDictionary(opened.page, dictionary, 60000);
        await verifyInstalledDictionaries(
            opened.page,
            [dictionary.title],
        );
        await configureProfile(
            opened.page,
            [dictionary.title],
            dictionary.title,
        );
        const result = await termsFind(opened.page, 'verja');
        if (result.count < 1) {
            throw new Error('Smoke lookup failed before restart.');
        }
    } finally {
        await context.close();
    }

    context = await launchContext(
        paths.baseProfile,
        paths.extension,
    );
    try {
        const opened = await openSettings(context);
        if (opened.extensionId !== extensionId) {
            throw new Error('Extension ID changed across restart.');
        }
        const dictionaries = await getDictionaryInfo(opened.page);
        if (
            !dictionaries.some(
                ({title, importSuccess}) => (
                    title === 'Yomitan-ISL benchmark smoke lexical' &&
                    importSuccess === true
                ),
            )
        ) {
            throw new Error(
                'Smoke dictionary did not survive Chromium restart.',
            );
        }
    } finally {
        await context.close();
    }

    cloneProfile(paths.baseProfile, paths.explicitProfile);
    setExtensionMode(paths.extension, 'explicit');

    context = await launchContext(
        paths.explicitProfile,
        paths.extension,
    );
    try {
        const opened = await openSettings(context);
        if (opened.extensionId !== extensionId) {
            throw new Error(
                'Extension ID changed between hybrid and explicit modes.',
            );
        }
        const dictionaries = await getDictionaryInfo(opened.page);
        if (
            !dictionaries.some(
                ({title, importSuccess}) => (
                    title === 'Yomitan-ISL benchmark smoke lexical' &&
                    importSuccess === true
                ),
            )
        ) {
            throw new Error(
                'Cloned profile did not preserve the smoke dictionary.',
            );
        }
        const result = await termsFind(opened.page, 'verja');
        if (result.count < 1) {
            throw new Error(
                'Smoke lookup failed in cloned explicit profile.',
            );
        }
    } finally {
        await context.close();
    }

    console.log('Persistent Chromium benchmark smoke test: PASS.');
}

/** */
async function main() {
    const {command, options, flags} = parseArgs(
        process.argv.slice(2),
    );
    const workspace = path.resolve(
        getOption(
            options,
            '--workspace',
            path.join(
                homedir(),
                '.cache',
                'yomitan-isl-browser-benchmark',
            ),
        ),
    );

    switch (command) {
        case 'smoke':
            await smoke(workspace);
            break;
        case 'prepare-base': {
            const lexical = getOption(options, '--lexical');
            const timeout = getInteger(
                getOption(
                    options,
                    '--import-timeout-minutes',
                    '120',
                ),
                '--import-timeout-minutes',
                1,
            );
            await prepareBase(
                workspace,
                lexical,
                flags.has('--reset'),
                timeout,
            );
            break;
        }
        case 'prepare-mode': {
            const mode = getMode(
                getOption(options, '--mode'),
            );
            const morphology = getOption(
                options,
                '--morphology',
            );
            const timeout = getInteger(
                getOption(
                    options,
                    '--import-timeout-minutes',
                    '120',
                ),
                '--import-timeout-minutes',
                1,
            );
            await prepareMode(
                workspace,
                mode,
                morphology,
                flags.has('--reset'),
                timeout,
            );
            break;
        }
        case 'run': {
            const mode = getMode(
                getOption(options, '--mode'),
            );
            const queries = getOptions(
                options,
                '--query',
            );
            for (const queryFile of getOptions(
                options,
                '--query-file',
            )) {
                queries.push(...readQueries(queryFile));
            }

            const warmupPasses = getInteger(
                getOption(options, '--warmup-passes', '1'),
                '--warmup-passes',
                0,
            );
            const repetitions = getInteger(
                getOption(options, '--repetitions', '1'),
                '--repetitions',
                1,
            );
            const processRuns = getInteger(
                getOption(options, '--process-runs', '1'),
                '--process-runs',
                1,
            );

            const outputs = getOptions(options, '--output');
            if (outputs.length > 1) {
                throw new Error(
                    '--output may be specified at most once.',
                );
            }

            await runBenchmark(
                workspace,
                mode,
                queries,
                warmupPasses,
                repetitions,
                processRuns,
                outputs[0] ?? null,
            );
            break;
        }
        default:
            throw new Error('Unknown command: ' + command);
    }
}

try {
    await main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
