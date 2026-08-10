import {Capacitor} from '@capacitor/core'
import {App} from '@capacitor/app'
import {Browser} from '@capacitor/browser'
import {Filesystem, Directory, Encoding} from '@capacitor/filesystem'
import {Share} from '@capacitor/share'

const isMobile = Capacitor.isNativePlatform()
if (isMobile) document.body.classList.add('snowstorm-mobile')

function base64FromDataUrl(dataUrl) {
	return String(dataUrl || '').replace(/^data:[^;]+;base64,/, '')
}

async function writeCacheFile(name, content, binary) {
	const safeName = String(name || 'snowstorm-export').replace(/[^a-zA-Z0-9._-]/g, '_')
	const data = binary ? base64FromDataUrl(content) : String(content ?? '')
	const result = await Filesystem.writeFile({
		path: safeName,
		directory: Directory.Cache,
		data,
		...(binary ? {} : {encoding: Encoding.UTF8})
	})
	const uri = await Filesystem.getUri({path: safeName, directory: Directory.Cache})
	return {name: safeName, uri: uri.uri || result.uri}
}

async function saveFile({name, content, binary = false}) {
	const file = await writeCacheFile(name, content, binary)
	await Share.share({
		title: file.name,
		files: [file.uri],
		dialogTitle: '导出 Snowstorm 文件'
	})
	return file
}

async function shareFiles(files) {
	const written = []
	for (const file of files || []) {
		written.push(await writeCacheFile(file.name, file.content, file.binary === true))
	}
	if (written.length) {
		await Share.share({
			title: 'Snowstorm 粒子效果',
			files: written.map(file => file.uri),
			dialogTitle: '分享 Snowstorm 粒子效果'
		})
	}
	return written
}

async function openExternal(url) {
	if (isMobile) return Browser.open({url})
	return window.open(url)
}

function decodeBase64Text(encoded) {
	const binary = atob(encoded)
	const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
	return new TextDecoder().decode(bytes)
}

async function openContent(name, encoded) {
	try {
		const text = decodeBase64Text(encoded)
		if (text) window.loadFileFromParentEffect?.(text, null)
	} catch (error) {
		console.warn(`Unable to open Android file ${name || ''}`, error)
	}
}

window.snowstormMobile = {
	isMobile,
	saveFile,
	shareFiles,
	openExternal
}
window.snowstormMobileOpenContent = openContent

if (isMobile) {
	App.addListener('backButton', async ({canGoBack}) => {
		if (canGoBack) window.history.back()
		else await App.minimizeApp()
	})
}

export {isMobile}
