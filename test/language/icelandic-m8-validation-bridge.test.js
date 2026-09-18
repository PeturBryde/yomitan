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

const validatorDictionary = 'M8 weak noun validator';
const residualDictionary = 'M8 experimental residual';
const lexicalDictionary = 'M8 ruleless lexical';

/** @type {Map<string, {id: number}>} */
const validators = new Map([
    ['kona', {id: 100}],
    ['dómari', {id: 101}],
]);

/** @type {Map<string, number>} */
const lexicalIds = new Map([
    ['kona', 200],
    ['dómari', 201],
    ['prufa', 202],
    ['bók', 203],
]);

/**
 * @param {number} index
 * @param {string} term
 * @param {string} dictionary
 * @param {number} id
 * @param {string[]} rules
 * @param {import('dictionary-data').TermGlossary[]} definitions
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
                    ['n-weak-def-sg-oblique'],
                    [[term, []]],
                ));
            }

            if (term === 'bókinni' && enabledDictionaryMap.has(residualDictionary)) {
                entries.push(createEntry(
                    index,
                    term,
                    residualDictionary,
                    150,
                    [],
                    [['bók', []]],
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
 * @returns {Map<string, import('translation').FindTermDictionary>}
 */
function createEnabledDictionaryMap() {
    return new Map([
        [validatorDictionary, {
            index: 0,
            alias: validatorDictionary,
            allowSecondarySearches: false,
            partsOfSpeechFilter: true,
            useDeinflections: true,
        }],
        [residualDictionary, {
            index: 1,
            alias: residualDictionary,
            allowSecondarySearches: false,
            partsOfSpeechFilter: true,
            useDeinflections: true,
        }],
        [lexicalDictionary, {
            index: 2,
            alias: lexicalDictionary,
            allowSecondarySearches: false,
            partsOfSpeechFilter: true,
            useDeinflections: true,
        }],
    ]);
}

/**
 * @param {Translator} translator
 * @param {string} text
 * @returns {Promise<import('dictionary').TermDictionaryEntry[]>}
 */
async function findTerms(translator, text) {
    const enabledDictionaryMap = createEnabledDictionaryMap();
    const {dictionaryEntries} = await translator.findTerms('simple', text, {
        matchType: 'exact',
        deinflect: true,
        mainDictionary: validatorDictionary,
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

describe('Icelandic M8 hybrid validator bridge', () => {
    test.each([
        ['konuna', 'kona'],
        ['konunni', 'kona'],
        ['konunnar', 'kona'],
        ['dómarann', 'dómari'],
        ['dómarans', 'dómari'],
        ['dómaranum', 'dómari'],
    ])('%s reaches %s through the hidden validator', async (surface, lemma) => {
        const dictionaryEntries = await findTerms(createTranslator(), surface);

        expect(dictionaryEntries).toHaveLength(1);
        expect(dictionaryEntries[0].headwords[0].term).toBe(lemma);
        expect(getDefinitionDictionaries(dictionaryEntries)).toStrictEqual([lexicalDictionary]);
        expect(getDefinitionDictionaries(dictionaryEntries)).not.toContain(validatorDictionary);
    });

    test('suffix match without validator support cannot reach a ruleless lexical entry', async () => {
        const dictionaryEntries = await findTerms(createTranslator(), 'prufuna');
        expect(dictionaryEntries).toHaveLength(0);
    });

    test('direct lemma lookup remains available and hides validator definitions', async () => {
        const dictionaryEntries = await findTerms(createTranslator(), 'kona');

        expect(dictionaryEntries).toHaveLength(1);
        expect(dictionaryEntries[0].headwords[0].term).toBe('kona');
        expect(getDefinitionDictionaries(dictionaryEntries)).toStrictEqual([lexicalDictionary]);
    });

    test('an explicit residual route coexists with the algorithmic family', async () => {
        const dictionaryEntries = await findTerms(createTranslator(), 'bókinni');

        expect(dictionaryEntries).toHaveLength(1);
        expect(dictionaryEntries[0].headwords[0].term).toBe('bók');
        expect(getDefinitionDictionaries(dictionaryEntries)).toStrictEqual([lexicalDictionary]);
        expect(getDefinitionDictionaries(dictionaryEntries)).not.toContain(residualDictionary);
    });
});
