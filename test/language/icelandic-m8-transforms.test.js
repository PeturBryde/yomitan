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

describe('Icelandic M8 transforms', () => {
    test.each([
        ['konuna', 'kona', 'feminine-definite-accusative-singular'],
        ['konunni', 'kona', 'feminine-definite-dative-singular'],
        ['konunnar', 'kona', 'feminine-definite-genitive-singular'],
        ['dómarann', 'dómari', 'masculine-definite-accusative-singular'],
        ['dómarans', 'dómari', 'masculine-definite-genitive-singular'],
        ['dómaranum', 'dómari', 'masculine-definite-dative-singular'],
    ])('%s deinflects to %s with the shared validator condition', (surface, lemma, transformId) => {
        const transformer = new LanguageTransformer();
        transformer.addDescriptor(icelandicTransforms);

        const condition = transformer.getConditionFlagsFromConditionType('n-weak-def-sg-oblique');
        expect(condition).not.toBe(0);

        const results = transformer.transform(surface);
        expect(results).toContainEqual({
            text: lemma,
            conditions: condition,
            trace: [{transform: transformId, ruleIndex: 0, text: surface}],
        });
    });

    test('all six rules share exactly one dictionary-form condition leaf', () => {
        const transformer = new LanguageTransformer();
        transformer.addDescriptor(icelandicTransforms);

        const condition = transformer.getConditionFlagsFromConditionType('n-weak-def-sg-oblique');
        expect(condition).toBe(1);
        expect(transformer.getConditionFlagsFromPartsOfSpeech(['n-weak-def-sg-oblique'])).toBe(condition);
    });

    test('user-facing rule names describe grammar rather than the compatibility condition', () => {
        const transformer = new LanguageTransformer();
        transformer.addDescriptor(icelandicTransforms);

        expect(transformer.getUserFacingInflectionRules([
            'feminine-definite-dative-singular',
            'masculine-definite-genitive-singular',
        ])).toStrictEqual([
            {
                name: 'feminine definite dative singular',
                description: 'Definite dative singular noun form',
            },
            {
                name: 'masculine definite genitive singular',
                description: 'Definite genitive singular noun form',
            },
        ]);
    });

    test('an unrelated form is left unconditioned', () => {
        const transformer = new LanguageTransformer();
        transformer.addDescriptor(icelandicTransforms);

        expect(transformer.transform('hestur')).toStrictEqual([
            {text: 'hestur', conditions: 0, trace: []},
        ]);
    });
});
