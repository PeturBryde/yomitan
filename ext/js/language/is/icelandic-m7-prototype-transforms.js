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

import {wholeWordInflection} from '../language-transforms.js';

/**
 * Temporary conditions used only to prove the Yomitan-ISL M7 validation bridge.
 * These are deliberately not a proposed production Icelandic taxonomy.
 */
const conditions = {
    'm7-proto-noun': {
        name: 'M7 prototype noun',
        isDictionaryForm: true,
    },
    'm7-proto-verb': {
        name: 'M7 prototype verb',
        isDictionaryForm: true,
    },
};

/** @type {import('language-transformer').LanguageTransformDescriptor<keyof typeof conditions>} */
export const icelandicM7PrototypeTransforms = {
    language: 'is',
    conditions,
    transforms: {
        'm7-proto-hestum': {
            name: 'M7 prototype noun route',
            description: 'Temporary exact-word transform used only to prove BÍN validation.',
            rules: [
                wholeWordInflection('hestum', 'hestur', [], ['m7-proto-noun']),
            ],
        },
        'm7-proto-for': {
            name: 'M7 prototype verb route',
            description: 'Temporary exact-word transform used only to prove BÍN validation.',
            rules: [
                wholeWordInflection('fór', 'fara', [], ['m7-proto-verb']),
            ],
        },
        'm7-proto-wrong': {
            name: 'M7 prototype wrong-condition route',
            description: 'Temporary deliberately invalid condition used to test validator rejection.',
            rules: [
                wholeWordInflection('prufurangt', 'maður', [], ['m7-proto-verb']),
            ],
        },
        'm7-proto-anna': {
            name: 'M7 prototype homograph route',
            description: 'Temporary exact-word transform used to inspect same-lemma homograph exposure.',
            rules: [
                wholeWordInflection('ánna', 'á', [], ['m7-proto-noun']),
            ],
        },
    },
};
