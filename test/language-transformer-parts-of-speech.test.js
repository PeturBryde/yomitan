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
import {LanguageTransformer} from '../ext/js/language/language-transformer.js';
import {wholeWordInflection} from '../ext/js/language/language-transforms.js';

const descriptor = {
    language: 'fixture',
    partsOfSpeech: ['noun', 'verb'],
    conditions: {
        inflected: {
            name: 'Inflected',
            isDictionaryForm: true,
        },
    },
    transforms: {
        past: {
            name: 'past',
            partOfSpeech: 'verb',
            rules: [
                wholeWordInflection('walked', 'walk', [], ['inflected']),
            ],
        },
    },
};

describe('LanguageTransformer lexical part-of-speech metadata', () => {
    test('transforms carry POS separately from condition flags', () => {
        const transformer = new LanguageTransformer();
        transformer.addDescriptor(descriptor);

        const results = transformer.transform('walked');
        const identity = results.find(({text}) => text === 'walked');
        const transformed = results.find(({text}) => text === 'walk');

        expect(identity?.partOfSpeech).toBeNull();
        expect(transformed?.partOfSpeech).toBe('verb');
        expect(transformed?.conditions).not.toBe(0);
    });

    test('recognized lexical POS rules are filtered without condition bits', () => {
        const transformer = new LanguageTransformer();
        transformer.addDescriptor(descriptor);

        expect(
            transformer.getLexicalPartsOfSpeech([
                'inflected',
                'verb',
                'unknown',
                'noun',
            ]),
        ).toStrictEqual(['verb', 'noun']);
    });

    test('transform POS must be declared by the descriptor', () => {
        const transformer = new LanguageTransformer();

        expect(() => transformer.addDescriptor({
            language: 'fixture',
            partsOfSpeech: ['verb'],
            conditions: {},
            transforms: {
                invalid: {
                    name: 'invalid',
                    partOfSpeech: 'noun',
                    rules: [],
                },
            },
        })).toThrow(/Invalid partOfSpeech/);
    });
});
