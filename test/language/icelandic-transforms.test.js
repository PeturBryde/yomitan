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
import {icelandicTransforms} from '../../ext/js/language/is/icelandic-transforms.js';
import {LanguageTransformer} from '../../ext/js/language/language-transformer.js';
import {testLanguageTransformer} from '../fixtures/language-transformer-test.js';

const tests = [
    {
        category: 'nouns',
        valid: true,
        tests: [
            {
                term: 'húsvinur',
                source: 'húsvini',
                rule: 'm13-provisional-k32-leaf-17',
                reasons: ['m13-provisional-global-068f61fdfe1a2b0f'],
            },
            {
                term: 'nándarmörk',
                source: 'nándarmarka',
                rule: 'm13-provisional-k32-leaf-03',
                reasons: ['m13-provisional-global-0619826c01c84619'],
            },
        ],
    },
    {
        category: 'adjectives',
        valid: true,
        tests: [
            {
                term: 'þjáningafullur',
                source: 'þjáningafyllstu',
                rule: 'm13-provisional-k32-leaf-01',
                reasons: ['m13-provisional-global-1124e11ebe39cc8e'],
            },
            {
                term: 'marinn',
                source: 'mörðu',
                rule: 'm13-provisional-k32-leaf-09',
                reasons: ['m13-provisional-global-0254c9ff734ae122'],
            },
        ],
    },
    {
        category: 'verbs',
        valid: true,
        tests: [
            {
                term: 'þaulskoða',
                source: 'þaulskoðuðuð',
                rule: 'm13-provisional-k32-leaf-01',
                reasons: ['m13-provisional-global-0ea3c2eab679dacd'],
            },
            {
                term: 'belgfylla',
                source: 'belgfyllti',
                rule: 'm13-provisional-k32-leaf-22',
                reasons: ['m13-provisional-global-002a3ce31bbd7f33'],
            },
        ],
    },
    {
        category: 'nonmatching',
        valid: false,
        tests: [
            {
                term: 'nándarmörk',
                source: 'húsvini',
                rule: null,
                reasons: null,
            },
        ],
    },
];

const languageTransformer = new LanguageTransformer();
languageTransformer.addDescriptor(icelandicTransforms);

testLanguageTransformer(languageTransformer, tests);

describe('Icelandic production transform metadata', () => {
    test('selected condition leaves are distinct and nonzero', () => {
        const conditions = [
            'm13-provisional-k32-leaf-01',
            'm13-provisional-k32-leaf-03',
            'm13-provisional-k32-leaf-09',
            'm13-provisional-k32-leaf-17',
            'm13-provisional-k32-leaf-22',
        ].map((condition) => languageTransformer.getConditionFlagsFromConditionType(condition));

        expect(conditions.every((condition) => condition !== 0)).toBe(true);
        expect(new Set(conditions).size).toBe(conditions.length);
    });

    test('user-facing rule names describe BÍN grammar', () => {
        expect(languageTransformer.getUserFacingInflectionRules([
            'm13-provisional-global-068f61fdfe1a2b0f',
            'm13-provisional-global-1124e11ebe39cc8e',
            'm13-provisional-global-0ea3c2eab679dacd',
        ])).toStrictEqual([
            {
                name: 'noun: masculine, indefinite, dative singular',
                description: 'BÍN grammatical analysis: noun: masculine, indefinite, dative singular',
            },
            {
                name: 'adjective: superlative, weak, feminine, genitive, singular',
                description: 'BÍN grammatical analysis: adjective: superlative, weak, feminine, genitive, singular',
            },
            {
                name: 'verb: active, indicative, past, second person, plural',
                description: 'BÍN grammatical analysis: verb: active, indicative, past, second person, plural',
            },
        ]);
    });
});
