/* eslint-disable */
module.exports = {
    "env": {
        "browser": true,
        "es2021": true,
        "node": true
    },
    "extends": [
        "airbnb-base"
    ],
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "ecmaVersion": 12,
        "sourceType": "module"
    },
    "plugins": [
        "@typescript-eslint"
    ],
    "rules": {
        // note you must disable the base rule as it can report incorrect errors
        "no-use-before-define": "off",
        "@typescript-eslint/no-use-before-define": ["error"],
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": ["error"],
        "no-shadow": "off",
        "@typescript-eslint/no-shadow": ["error"],
        "import/prefer-default-export": "off",
        "import/extensions": [
            "error",
            "ignorePackages",
            {
              "js": "never",
              "ts": "never",
            }
        ],
        "no-restricted-syntax": [
            "error",
            "ForInStatement",
            "LabeledStatement",
            "WithStatement"
        ],
        "quotes": [
            "error",
            "single",
            {
                "allowTemplateLiterals": true
            }
        ],
        "max-classes-per-file": "off",
        "no-underscore-dangle": [
            "error",
            {
                "allow": ["_id"]
            }
        ],
        "no-continue": "off"
    },
    "settings": {
        "import/resolver": {
            "node": {
                "extensions": [".js", ".ts"]
            }
        }
    }
}
