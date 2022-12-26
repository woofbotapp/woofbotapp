/* eslint-disable */

const commonEslint = require("../common/.eslintrc");

module.exports = {
    "env": {
        "browser": true,
        "es2021": true
    },
    "extends": [
        "plugin:react/recommended",
        "airbnb-base"
    ],
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "ecmaFeatures": {
            "jsx": true
        },
        "ecmaVersion": 12,
        "sourceType": "module"
    },
    "plugins": [
        "react",
        "@typescript-eslint"
    ],
    "rules": {
        ...commonEslint.rules,
        "react/jsx-filename-extension": [2, { "extensions": [".jsx", ".tsx"] }],
        "import/extensions": [
            "error",
            "ignorePackages",
            {
              "js": "never",
              "jsx": "never",
              "ts": "never",
              "tsx": "never"
            }
        ],
    },
    "settings": {
        "import/resolver": {
            "node": {
                "extensions": [".js", ".jsx", ".ts", ".tsx"]
            }
        }
    }
}
