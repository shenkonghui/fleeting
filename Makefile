.PHONY: run install build

run:
	npm start

build:
	npm run build

install: build
	hdiutil attach dist/Fleeting-1.0.0-arm64.dmg -nobrowse
	cp -R "/Volumes/Fleeting 1.0.0-arm64/Fleeting.app" /Applications/
	hdiutil detach "/Volumes/Fleeting 1.0.0-arm64"
	@echo "✅ Fleeting 已安装到 /Applications"
