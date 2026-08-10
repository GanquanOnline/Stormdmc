import vscode from './vscode_extension'
import {loadFromUrl} from './share'

if (!vscode) {
    if (!window.snowstormDesktop) {
    window.onbeforeunload = function() {
        return 'Your changes might not be saved';
    }

    async function registerSW() {
        try {
            await navigator.serviceWorker.register('./service_worker.js');
        } catch (err) {
            console.log(err)
        }
	}
    if ('serviceWorker' in navigator) {
        registerSW();
    }
    }

    loadFromUrl()
}
