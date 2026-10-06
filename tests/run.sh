#!/bin/bash
# Copies the live crypto module next to the harness (Node treats assets/*.js as
# CommonJS, so it must be a sibling .js here) and runs the tests.
set -e
cd "$(dirname "$0")"
cp ../assets/js/giftexchange/crypto.js ./crypto.js
node crypto.test.mjs
