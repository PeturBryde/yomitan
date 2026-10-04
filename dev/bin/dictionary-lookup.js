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
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {basename, join, resolve} from 'path';
import {IDBKeyRange, indexedDB} from 'fake-indexeddb';
import {createDictionaryArchiveData} from '../dictionary-archive-util.js';
import {DictionaryDatabase} from '../../ext/js/dictionary/dictionary-database.js';
import {DictionaryImporter} from '../../ext/js/dictionary/dictionary-importer.js';
import {Translator} from '../../ext/js/language/translator.js';
import {chrome, fetch} from '../../test/mocks/common.js';
import {DictionaryImporterMediaLoader} from '../../test/mocks/dictionary-importer-media-loader.js';

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
globalThis.fetch = fetch;
globalThis.chrome = chrome;

/**
 * @param {string[]} args
 * @returns {{language: string, dictionaries: string[], queries: string[]}}
 */
function parseArgs(args) {
    let language = 'is';
    const dictionaries = [];
    const queries = [];

    for (let i = 0; i < args.length; ++i) {
        const arg = args[i];
        switch (arg) {
            case '--language':
                language = requireValue(args, ++i, arg);
                break;
            case '--dictionary':
                dictionaries.push(requireValue(args, ++i, arg));
                break;
            case '--query':
                queries.push(requireValue(args, ++i, arg));
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (dictionaries.length === 0 || queries.length === 0) {
        throw new Error(
            'At least one --dictionary and one --query are required.',
        );
    }
    return {language, dictionaries, queries};
}

/**
 * @param {string[]} args
 * @param {number} index
 * @param {string} option
 * @returns {string}
 */
function requireValue(args, index, option) {
    const value = args[index];
    if (typeof value === 'undefined') {
        throw new Error(`Missing value for ${option}`);
    }
    return value;
}

/**
 * Repackages one normal dictionary ZIP as an uncompressed in-memory archive.
 * Yomitan's Node test ZIP implementation cannot inflate normal compressed
 * dictionary ZIPs, but DictionaryImporter can otherwise process the same files.
 *
 * @param {string} dictionaryPath
 * @returns {Promise<ArrayBuffer>}
 */
async function createNodeImportArchive(dictionaryPath) {
    const directory = mkdtempSync(join(tmpdir(), 'yomitan-dictionary-lookup-'));
    try {
        execFileSync(
            'unzip',
            ['-q', '-o', dictionaryPath, '-d', directory],
            {stdio: 'pipe'},
        );
        return await createDictionaryArchiveData(directory);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
}

/**
 * @param {DictionaryDatabase} database
 * @param {string} dictionaryPath
 * @returns {Promise<string>}
 */
async function importDictionary(database, dictionaryPath) {
    const archive = await createNodeImportArchive(dictionaryPath);
    const importer = new DictionaryImporter(new DictionaryImporterMediaLoader());
    const {errors, result} = await importer.importDictionary(
        database,
        archive,
        {prefixWildcardsSupported: true, yomitanVersion: '0.0.0.0'},
    );
    if (errors.length > 0 || result === null) {
        const messages = errors.map(({message}) => message).join('; ');
        throw new Error(
            `Failed to import ${dictionaryPath}: ${messages || 'unknown error'}`,
        );
    }
    console.log(`Imported ${basename(dictionaryPath)} as "${result.title}"`);
    return result.title;
}

/**
 * @param {string[]} dictionaryTitles
 * @returns {Map<string, import('translation').FindTermDictionary>}
 */
function createEnabledDictionaryMap(dictionaryTitles) {
    return new Map(
        dictionaryTitles.map((title, index) => [
            title,
            {
                index,
                alias: title,
                allowSecondarySearches: false,
                partsOfSpeechFilter: true,
                useDeinflections: true,
            },
        ]),
    );
}

/**
 * @param {import('dictionary').TermDictionaryEntry} entry
 * @returns {string[]}
 */
function getDefinitionDictionaries(entry) {
    return [...new Set(entry.definitions.map(({dictionary}) => dictionary))];
}

/**
 * @param {import('dictionary').TermDictionaryEntry} entry
 * @returns {string[]}
 */
function getInflectionDescriptions(entry) {
    return entry.inflectionRuleChainCandidates.map(
        ({source, inflectionRules}) => {
            const names = inflectionRules.map(({name}) => name);
            return `${source}: ${names.length > 0 ? names.join(' -> ') : '(none)'}`;
        },
    );
}

/**
 * @param {Translator} translator
 * @param {string} query
 * @param {string} language
 * @param {Map<string, import('translation').FindTermDictionary>} enabledDictionaryMap
 * @param {string} mainDictionary
 */
async function runQuery(
    translator,
    query,
    language,
    enabledDictionaryMap,
    mainDictionary,
) {
    const {dictionaryEntries} = await translator.findTerms('simple', query, {
        matchType: 'exact',
        deinflect: true,
        mainDictionary,
        sortFrequencyDictionary: null,
        sortFrequencyDictionaryOrder: 'descending',
        removeNonJapaneseCharacters: false,
        primaryReading: '',
        textReplacements: [null],
        enabledDictionaryMap,
        excludeDictionaryDefinitions: null,
        searchResolution: 'word',
        language,
        useAllFrequencyDictionaries: false,
    });

    console.log(`\nQUERY ${JSON.stringify(query)}: ${dictionaryEntries.length} result(s)`);
    for (const [index, entry] of dictionaryEntries.entries()) {
        const headwords = entry.headwords.map(
            ({term, wordClasses}) => (
                `${term}${wordClasses.length > 0 ? ` [${wordClasses.join(', ')}]` : ''}`
            ),
        );
        console.log(`  ${index + 1}. ${headwords.join(' / ')}`);
        console.log(
            `     dictionaries: ${getDefinitionDictionaries(entry).join(', ')}`,
        );
        const inflections = getInflectionDescriptions(entry);
        if (inflections.length > 0) {
            console.log(`     inflections: ${inflections.join(' | ')}`);
        }
    }
}

/** */
async function main() {
    const {language, dictionaries, queries} = parseArgs(process.argv.slice(2));
    const dictionaryPaths = dictionaries.map((path) => resolve(path));

    const database = new DictionaryDatabase();
    await database.prepare();

    const dictionaryTitles = [];
    for (const dictionaryPath of dictionaryPaths) {
        dictionaryTitles.push(await importDictionary(database, dictionaryPath));
    }

    const translator = new Translator(database);
    translator.prepare();

    const enabledDictionaryMap = createEnabledDictionaryMap(dictionaryTitles);
    for (const query of queries) {
        await runQuery(
            translator,
            query,
            language,
            enabledDictionaryMap,
            dictionaryTitles[0],
        );
    }
}

try {
    await main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
