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

const validatorDictionary = 'Icelandic BÍN validator fixture';
const residualDictionary = 'Icelandic residual fixture';
const lexicalDictionary = 'Icelandic lexical fixture';

/** @type {Map<string, string[]>} */
const defaultValidatorRules = new Map([
    ['húsvinur', ['m13-provisional-k32-leaf-17']],
    ['þjáningafullur', ['m13-provisional-k32-leaf-01']],
    ['þaulskoða', ['m13-provisional-k32-leaf-01']],
]);

/** @type {Map<string, number>} */
const lexicalIds = new Map([
    ['húsvinur', 200],
    ['þjáningafullur', 201],
    ['þaulskoða', 202],
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
 * @param {Map<string, string[]>} validatorRules
 * @returns {Translator}
 */
function createTranslator(validatorRules = defaultValidatorRules) {
    /**
     * @param {string[]} termList
     * @param {Map<string, import('translation').FindTermDictionary>} enabledDictionaryMap
     * @returns {Promise<import('dictionary-database').TermEntry[]>}
     */
    async function findTermsBulk(termList, enabledDictionaryMap) {
        /** @type {import('dictionary-database').TermEntry[]} */
        const entries = [];
        for (const [index, term] of termList.entries()) {
            const rules = validatorRules.get(term);
            if (typeof rules !== 'undefined' && enabledDictionaryMap.has(validatorDictionary)) {
                entries.push(createEntry(
                    index,
                    term,
                    validatorDictionary,
                    100 + index,
                    rules,
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

            if (term === 'verstu' && enabledDictionaryMap.has(residualDictionary)) {
                entries.push(createEntry(
                    index,
                    term,
                    residualDictionary,
                    151,
                    ['verb'],
                    [['verja', ['BÍN: so MM-BH-ET']]],
                ));
            }

            if (term === 'verja' && enabledDictionaryMap.has(lexicalDictionary)) {
                entries.push(
                    createEntry(
                        index,
                        term,
                        lexicalDictionary,
                        204,
                        ['noun'],
                        ['verja noun definition'],
                    ),
                    createEntry(
                        index,
                        term,
                        lexicalDictionary,
                        205,
                        ['verb'],
                        ['verja verb definition'],
                    ),
                );
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
    const {dictionaryEntries} = await translator.findTerms('simple', text, {
        matchType: 'exact',
        deinflect: true,
        mainDictionary: validatorDictionary,
        sortFrequencyDictionary: null,
        sortFrequencyDictionaryOrder: 'descending',
        removeNonJapaneseCharacters: false,
        primaryReading: '',
        textReplacements: [null],
        enabledDictionaryMap: createEnabledDictionaryMap(),
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

/**
 * @param {import('dictionary').TermDictionaryEntry} dictionaryEntry
 * @returns {{source: string, inflectionRules: string[]}[]}
 */
function getInflectionRuleChains(dictionaryEntry) {
    return dictionaryEntry.inflectionRuleChainCandidates.map(
        ({source, inflectionRules}) => ({
            source,
            inflectionRules: inflectionRules.map(({name}) => name),
        }),
    );
}

describe('Icelandic production validator bridge', () => {
    test.each([
        ['húsvini', 'húsvinur', 'noun: masculine, indefinite, dative singular'],
        ['þjáningafyllstu', 'þjáningafullur', 'adjective: superlative, weak, feminine, genitive, singular'],
        ['þaulskoðuðuð', 'þaulskoða', 'verb: active, indicative, past, second person, plural'],
    ])('%s reaches %s through the hidden BÍN validator', async (surface, lemma, ruleName) => {
        const dictionaryEntries = await findTerms(createTranslator(), surface);

        expect(dictionaryEntries).toHaveLength(1);
        expect(dictionaryEntries[0].headwords[0].term).toBe(lemma);
        expect(getDefinitionDictionaries(dictionaryEntries)).toStrictEqual([lexicalDictionary]);
        expect(getDefinitionDictionaries(dictionaryEntries)).not.toContain(validatorDictionary);
        expect(getInflectionRuleChains(dictionaryEntries[0])).toContainEqual({
            source: 'both',
            inflectionRules: [ruleName],
        });
    });

    test('an incompatible validator cannot expose a ruleless lexical entry', async () => {
        const incompatibleValidatorRules = new Map([
            ['húsvinur', []],
        ]);
        const dictionaryEntries = await findTerms(
            createTranslator(incompatibleValidatorRules),
            'húsvini',
        );

        expect(dictionaryEntries).toHaveLength(0);
    });

    test('direct lemma lookup remains available and hides validator definitions', async () => {
        const dictionaryEntries = await findTerms(createTranslator(), 'húsvinur');

        expect(dictionaryEntries).toHaveLength(1);
        expect(dictionaryEntries[0].headwords[0].term).toBe('húsvinur');
        expect(getDefinitionDictionaries(dictionaryEntries)).toStrictEqual([lexicalDictionary]);
        expect(getDefinitionDictionaries(dictionaryEntries)).not.toContain(validatorDictionary);
    });


    test('residual POS restricts downstream homographic lexical entries', async () => {
        const translator = createTranslator();

        const directEntries = await findTerms(translator, 'verja');
        expect(directEntries).toHaveLength(2);
        expect(
            directEntries.map(({headwords: [{wordClasses}]}) => wordClasses),
        ).toStrictEqual([['noun'], ['verb']]);

        const inflectedEntries = await findTerms(translator, 'verstu');
        expect(inflectedEntries).toHaveLength(1);
        expect(inflectedEntries[0].headwords[0].term).toBe('verja');
        expect(inflectedEntries[0].headwords[0].wordClasses).toStrictEqual(['verb']);
        expect(inflectedEntries[0].definitions[0].entries).toStrictEqual([
            'verja verb definition',
        ]);
        expect(getDefinitionDictionaries(inflectedEntries)).not.toContain(
            residualDictionary,
        );
    });

    test('an explicit residual route remains available alongside algorithmic morphology', async () => {
        const dictionaryEntries = await findTerms(createTranslator(), 'bókinni');

        expect(dictionaryEntries).toHaveLength(1);
        expect(dictionaryEntries[0].headwords[0].term).toBe('bók');
        expect(getDefinitionDictionaries(dictionaryEntries)).toStrictEqual([lexicalDictionary]);
        expect(getDefinitionDictionaries(dictionaryEntries)).not.toContain(residualDictionary);
    });
});
