import { tmpdir } from 'node:os'
import { v4 as uuidv4 } from 'uuid'

const tmpdirPath = tmpdir()

export function getDay(): string {
	const date = new Date()
	return [date.getFullYear(), padding(date.getMonth() + 1), padding(date.getDate())].join('_')
}

export function padding(val: number): string {
	return val >= 0 && val <= 9 ? `0${val}` : `${val}`
}

export function genFilename(ext: string): string {
	return `${tmpdirPath}/${uuidv4()}.${ext}`
}

export const FUNCTION_WRAPPER = (code: string) => `(async function() {
        try {
            const data = await (async function() {
                ${code}
            })();
            const ret = { code: 0 };
            if (data) {
                ret.data = data;
            }
            return JSON.stringify(ret);
        } catch (e) {
            return JSON.stringify({code : -1, message: e.message});
        }
    })();
    `
