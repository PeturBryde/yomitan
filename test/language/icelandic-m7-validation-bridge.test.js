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

import {describe, expect, test} from 'vitest';
import {Translator} from '../../ext/js/language/translator.js';

const validatorDictionary = 'M7 Icelandic validator';
const lexicalDictionary = 'M7 ruleless lexical';
const ruledLexicalDictionary = 'M7 ruled lexical';

/** @type {Map<string, {condition: string, id: number}>} */
const validators = new Map([
    ['hestur', {condition: 'm7-proto-noun', id: 100}],
    ['maður', {condition: 'm7-proto-noun', id: 101}],
    ['fara', {condition: 'm7-proto-verb', id: 102}],
    ['á', {condition: 'm7-proto-noun', id: 103}],
]);

/** @type {Map<string, number>} */
const lexicalIds = new Map([
    ['hestur', 200],
    ['maður', 201],
    ['fara', 202],
    ['á', 203],
]);

/**
 * @param {number} index
 * @param {string} term
 * @param {string} dictionary
 * @param {number} id
 * @param {string[]} rules
 * @param {import('dictionary-data').TermGlossaryContent[]} definitions
 * @returns {import('dictionary-database').TermEntry}
 */
function createEntry(index, term, dictionary, id, rules, definitions) {
    return {
        index,
        matchType: 'exact',
        matchSource: 'term',
        term,
        reading: '',
        definitionTags: [],
        termTags: [],
        rules,
        definitions,
        score: 1,
        dictionary,
        id,
        sequence: -1,
    };
}

/**
 * @returns {Translator}
 */
function createTranslator() {
    /**
     * @param {string[]} termList
     * @param {Map<string, import('translation').FindTermDictionary>} enabledDictionaryMap
     * @returns {Promise<import('dictionary-database').TermEntry[]>}
     */
    async function findTermsBulk(termList, enabledDictionaryMap) {
        /** @type {import('dictionary-database').TermEntry[]} */
        const entries = [];
        for (const [index, term] of termList.entries()) {
            const validator = validators.get(term);
            if (validator && enabledDictionaryMap.has(validatorDictionary)) {
                entries.push(createEntry(
                    index,
                    term,
                    validatorDictionary,
                    validator.id,
                    [validator.condition],
                    [[term, []]],
                ));
            }

            const lexicalId = lexicalIds.get(term);
            if (typeof lexicalId !== 'undefined' && enabledDictionaryMap.has(lexicalDictionary)) {
                entries.push(createEntry(
                    index,
                    term,
                    lexicalDictionary,
                    lexicalId,
                    [],
                    [`${term} lexical definition`],
                ));
            }

            if (
                term === 'hestur' &&
                enabledDictionaryMap.has(ruledLexicalDictionary)
            ) {
                entries.push(createEntry(
                    index,
                    term,
                    ruledLexicalDictionary,
                    300,
                    ['m7-proto-noun'],
                    ['hestur ruled lexical definition'],
                ));
            }
        }
        return entries;
    }

    const translator = new Translator(
        /** @type {import('../../ext/js/dictionary/dictionary-database.js').DictionaryDatabase} */
        (/** @type {unknown} */ ({findTermsBulk})),
    );
    translator.prepare();
    return translator;
}

/**
 * @param {{
 *   validatorPartsOfSpeechFilter?: boolean,
 *   validatorUseDeinflections?: boolean,
 *   lexicalPartsOfSpeechFilter?: boolean,
 *   includeValidator?: boolean,
 *   includeLexical?: boolean,
 *   includeRuledLexical?: boolean,
 * }} [overrides]
 * @returns {Map<string, import('translation').FindTermDictionary>}
 */
function createEnabledDictionaryMap(overrides = {}) {
    const {
        validatorPartsOfSpeechFilter = true,
        validatorUseDeinflections = true,
        lexicalPartsOfSpeechFilter = true,
        includeValidator = true,
        includeLexical = true,
        includeRuledLexical = false,
    } = overrides;

    /** @type {Map<string, import('translation').FindTermDictionary>} */
    const enabledDictionaryMap = new Map();
    if (includeValidator) {
        enabledDictionaryMap.set(validatorDictionary, {
            index: 0,
            alias: validatorDictionary,
            allowSecondarySearches: false,
            partsOfSpeechFilter: validatorPartsOfSpeechFilter,
            useDeinflections: validatorUseDeinflections,
        });
    }
    if (includeLexical) {
        enabledDictionaryMap.set(lexicalDictionary, {
            index: 1,
            alias: lexicalDictionary,
            allowSecondarySearches: false,
            partsOfSpeechFilter: lexicalPartsOfSpeechFilter,
            useDeinflections: true,
        });
    }
    if (includeRuledLexical) {
        enabledDictionaryMap.set(ruledLexicalDictionary, {
            index: 2,
            alias: ruledLexicalDictionary,
            allowSecondarySearches: false,
            partsOfSpeechFilter: true,
            useDeinflections: true,
        });
    }
    return enabledDictionaryMap;
}

/**
 * @param {Translator} translator
 * @param {string} text
 * @param {Map<string, import('translation').FindTermDictionary>} enabledDictionaryMap
 * @returns {Promise<import('dictionary').TermDictionaryEntry[]>}
 */
async function findTerms(translator, text, enabledDictionaryMap) {
    const mainDictionary = enabledDictionaryMap.keys().next().value;
    if (typeof mainDictionary !== 'string') {
        throw new Error('At least one test dictionary must be enabled');
    }

    const {dictionaryEntries} = await translator.findTerms('simple', text, {
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
        language: 'is',
        useAllFrequencyDictionaries: false,
    });
    return dictionaryEntries;
}

/**
 * @param {import('dictionary').TermDictionaryEntry[]} dictionaryEntries
 * @returns {string[]}
 */
function getDefinitionDictionaries(dictionaryEntries) {
    return dictionaryEntries.flatMap(
        ({definitions}) => definitions.map(({dictionary}) => dictionary),
    );
}

describe('Icelandic M7 BÍN validation bridge', () => {
    test('valid condition reaches a ruleless lexical dictionary through the hidden validator', async () => {
        const translator = createTranslator();
        const dictionaryEntries = await findTerms(
            translator,
            'hestum',
            createEnabledDictionaryMap(),
        );

        expect(dictionaryEntries).toHaveLength(1);
        expect(dictionaryEntries[0].headwords[0].term).toBe('hestur');
        expect(getDefinitionDictionaries(dictionaryEntries)).toStrictEqual([lexicalDictionary]);
        expect(dictionaryEntries[0].inflectionRuleChainCandidates).toContainEqual({
            source: 'both',
            inflectionRules: [
                {
                    name: 'M7 prototype noun route',
                    description: 'Temporary exact-word transform used only to prove BÍN validation.',
                },
            ],
        });
    });

    test('wrong condition is rejected when validator and lexical POS filters are enabled', async () => {
        const translator = createTranslator();
        const dictionaryEntries = await findTerms(
            translator,
            'prufurangt',
            createEnabledDictionaryMap(),
        );

        expect(dictionaryEntries).toHaveLength(0);
    });

    test('disabling validator POS filtering lets a wrong condition through the bridge', async () => {
        const translator = createTranslator();
        const dictionaryEntries = await findTerms(
            translator,
            'prufurangt',
            createEnabledDictionaryMap({validatorPartsOfSpeechFilter: false}),
        );

        expect(dictionaryEntries).toHaveLength(1);
        expect(dictionaryEntries[0].headwords[0].term).toBe('maður');
        expect(getDefinitionDictionaries(dictionaryEntries)).toStrictEqual([lexicalDictionary]);
    });

    test('disabling validator deinflections prevents a valid bridge result', async () => {
        const translator = createTranslator();
        const dictionaryEntries = await findTerms(
            translator,
            'hestum',
            createEnabledDictionaryMap({validatorUseDeinflections: false}),
        );

        expect(dictionaryEntries).toHaveLength(0);
    });

    test('disabling lexical POS filtering lets a ruleless lexical entry bypass validation', async () => {
        const translator = createTranslator();
        const dictionaryEntries = await findTerms(
            translator,
            'prufurangt',
            createEnabledDictionaryMap({lexicalPartsOfSpeechFilter: false}),
        );

        expect(dictionaryEntries).toHaveLength(1);
        expect(dictionaryEntries[0].headwords[0].term).toBe('maður');
        expect(getDefinitionDictionaries(dictionaryEntries)).toStrictEqual([lexicalDictionary]);
        expect(dictionaryEntries[0].inflectionRuleChainCandidates[0].source).toBe('algorithm');
    });

    test('lexical entry with compatible rules can match directly without the validator', async () => {
        const translator = createTranslator();
        const dictionaryEntries = await findTerms(
            translator,
            'hestum',
            createEnabledDictionaryMap({
                includeValidator: false,
                includeLexical: false,
                includeRuledLexical: true,
            }),
        );

        expect(dictionaryEntries).toHaveLength(1);
        expect(dictionaryEntries[0].headwords[0].term).toBe('hestur');
        expect(getDefinitionDictionaries(dictionaryEntries)).toStrictEqual([ruledLexicalDictionary]);
        expect(dictionaryEntries[0].inflectionRuleChainCandidates[0].source).toBe('algorithm');
    });

    test('direct lemma lookup remains normal and validator definitions stay hidden', async () => {
        const translator = createTranslator();
        const dictionaryEntries = await findTerms(
            translator,
            'hestur',
            createEnabledDictionaryMap(),
        );

        expect(dictionaryEntries).toHaveLength(1);
        expect(dictionaryEntries[0].headwords[0].term).toBe('hestur');
        expect(getDefinitionDictionaries(dictionaryEntries)).toStrictEqual([lexicalDictionary]);
        expect(getDefinitionDictionaries(dictionaryEntries)).not.toContain(validatorDictionary);
    });

    test('verb and homograph prototype routes use their intended temporary conditions', async () => {
        const translator = createTranslator();

        const verbEntries = await findTerms(
            translator,
            'fór',
            createEnabledDictionaryMap(),
        );
        expect(verbEntries).toHaveLength(1);
        expect(verbEntries[0].headwords[0].term).toBe('fara');

        const homographEntries = await findTerms(
            translator,
            'ánna',
            createEnabledDictionaryMap(),
        );
        expect(homographEntries).toHaveLength(1);
        expect(homographEntries[0].headwords[0].term).toBe('á');
    });
});
