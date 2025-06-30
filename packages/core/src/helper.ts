import { tmpdir } from 'os'
import { v4 as uuidv4 } from 'uuid'

const tmpdirPath = tmpdir()
const HOST = process.env.MITO_HOST || 'example.com'

export function getDay() {
	const date = new Date()
	return [date.getFullYear(), padding(date.getMonth() + 1), padding(date.getDate())].join('_')
}

export function padding(val) {
	return val >= 0 && val <= 9 ? `0${val}` : val
}

export function genFilename(ext) {
	return `${tmpdirPath}/${uuidv4()}.${ext}`
}

export enum CHROME_DEV_TASK_TYPE {
	CPU_PROFILE = 'cpu.cpuprofile',
	HEAP_PROFILE = 'cpu.heapprofile',
	HEAP_SNAPSHOT = 'heapsnapshot.heapsnapshot',
}

export function getDevToolsUrl({ filename, dest }) {
	const fetchPrefix = encodeURIComponent(`https://${HOST}/api_nodejs/functions/tos-proxy?gunzip=1&key=`)

	return `https://unpkg.byted-static.com/byted/devtools-frontend/1.0.13/front_end/nemo.html?fetchprefix=${fetchPrefix}&fileid=${encodeURIComponent(dest)}&filename=${filename}`
}

export async function upload(filename: string) {
	// todo
	console.log(`upload: ${filename}`)
	return {
		dest: filename,
		url: filename,
	}
}
