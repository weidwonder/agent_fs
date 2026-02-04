#!/bin/bash

set -euo pipefail

cd "$(dirname "$0")/excel-converter"

echo "Testing ping..."
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | dotnet run

# echo '{"jsonrpc":"2.0","id":2,"method":"convert","params":{"filePath":"/path/to/test.xlsx"}}' | dotnet run
