/* eslint-disable */

const commonEslint = require("../common/.eslintrc");

module.exports = {
    "env": {
        "es2022": true,
        "node": true
    },
    "extends": [
        "airbnb-base"
    ],
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "ecmaVersion": 13,
        "sourceType": "module"
    },
    "plugins": [
        "@typescript-eslint"
    ],
    "rules": {
        ...commonEslint.rules,
    },
    "settings": {
        "import/resolver": {
            "node": {
                "extensions": [".js", ".ts"]
            }
        }
    }
}
