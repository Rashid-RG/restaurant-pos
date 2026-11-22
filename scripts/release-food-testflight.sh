#!/usr/bin/env bash
set -euo pipefail
: "${ASC_KEY_ID:?Configure FOOD_ASC_KEY_ID}" "${ASC_ISSUER_ID:?Configure FOOD_ASC_ISSUER_ID}"
: "${ASC_PRIVATE_KEY:?Configure FOOD_ASC_PRIVATE_KEY}" "${APPLE_TEAM_ID:?Configure FOOD_APPLE_TEAM_ID}"
: "${GITHUB_RUN_NUMBER:?}" "${GITHUB_RUN_ATTEMPT:?}" "${RUNNER_TEMP:?}"
umask 077
release_dir=$(mktemp -d "$RUNNER_TEMP/food-testflight.XXXXXX")
trap 'rm -rf "$release_dir"' EXIT
key_file="$release_dir/AuthKey.p8"
printf '%s\n' "$ASC_PRIVATE_KEY" > "$key_file"
unset ASC_PRIVATE_KEY
auth=(-allowProvisioningUpdates -authenticationKeyPath "$key_file" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
project=apps/customer-web/ios/App/App.xcodeproj
# Use three increasing components, including a distinct value on workflow retry.
build="$((1 + GITHUB_RUN_NUMBER / 100)).$((GITHUB_RUN_NUMBER % 100)).$GITHUB_RUN_ATTEMPT"
xcodebuild -project "$project" -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$release_dir/Food.xcarchive" \
  "${auth[@]}" DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic \
  CURRENT_PROJECT_VERSION="$build" archive
app_plist="$release_dir/Food.xcarchive/Products/Applications/App.app/Info.plist"
test "$(plutil -extract CFBundleIdentifier raw -o - "$app_plist")" = com.rstechnologies.gastrofood
test "$(plutil -extract CFBundleVersion raw -o - "$app_plist")" = "$build"
options="$release_dir/ExportOptions.plist"
plutil -create xml1 "$options"
plutil -insert method -string app-store-connect "$options"
plutil -insert destination -string upload "$options"
plutil -insert teamID -string "$APPLE_TEAM_ID" "$options"
plutil -insert signingStyle -string automatic "$options"
plutil -insert manageAppVersionAndBuildNumber -bool NO "$options"
plutil -insert testFlightInternalTestingOnly -bool YES "$options"
xcodebuild -exportArchive -archivePath "$release_dir/Food.xcarchive" \
  -exportPath "$release_dir/export" -exportOptionsPlist "$options" "${auth[@]}"
