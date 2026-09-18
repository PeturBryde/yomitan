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

import {suffixInflection} from '../language-transforms.js';

const conditions = {
    'n-weak-def-sg-oblique': {
        name: 'Weak noun, definite singular oblique',
        isDictionaryForm: true,
    },
};

/** @type {import('language-transformer').LanguageTransformDescriptor<keyof typeof conditions>} */
export const icelandicTransforms = {
    language: 'is',
    conditions,
    transforms: {
        'feminine-definite-accusative-singular': {
            name: 'feminine definite accusative singular',
            description: 'Definite accusative singular noun form',
            rules: [
                suffixInflection('una', 'a', [], ['n-weak-def-sg-oblique']),
            ],
        },
        'feminine-definite-dative-singular': {
            name: 'feminine definite dative singular',
            description: 'Definite dative singular noun form',
            rules: [
                suffixInflection('unni', 'a', [], ['n-weak-def-sg-oblique']),
            ],
        },
        'feminine-definite-genitive-singular': {
            name: 'feminine definite genitive singular',
            description: 'Definite genitive singular noun form',
            rules: [
                suffixInflection('unnar', 'a', [], ['n-weak-def-sg-oblique']),
            ],
        },
        'masculine-definite-accusative-singular': {
            name: 'masculine definite accusative singular',
            description: 'Definite accusative singular noun form',
            rules: [
                suffixInflection('ann', 'i', [], ['n-weak-def-sg-oblique']),
            ],
        },
        'masculine-definite-genitive-singular': {
            name: 'masculine definite genitive singular',
            description: 'Definite genitive singular noun form',
            rules: [
                suffixInflection('ans', 'i', [], ['n-weak-def-sg-oblique']),
            ],
        },
        'masculine-definite-dative-singular': {
            name: 'masculine definite dative singular',
            description: 'Definite dative singular noun form',
            rules: [
                suffixInflection('anum', 'i', [], ['n-weak-def-sg-oblique']),
            ],
        },
    },
};
