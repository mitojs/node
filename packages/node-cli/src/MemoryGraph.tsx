/** biome-ignore-all lint/suspicious/noArrayIndexKey: <explanation> */

import { Box, Text } from 'ink'
import type React from 'react'
import { useEffect, useState } from 'react'

interface MemorySnapshot {
	heapUsed: number
	heapTotal: number
	rss: number
}

interface MemoryGraphProps {
	getMemoryData: () => Promise<MemorySnapshot>
}

function formatMB(bytes: number): string {
	return (bytes / 1024 / 1024).toFixed(1)
}

const MemoryGraph: React.FC<MemoryGraphProps> = ({ getMemoryData }) => {
	const [data, setData] = useState<MemorySnapshot[]>([])

	useEffect(() => {
		let active = true
		const poll = async () => {
			while (active) {
				try {
					const snapshot = await getMemoryData()
					setData((prev) => {
						const next = [...prev, snapshot]
						if (next.length > 30) next.shift()
						return next
					})
				} catch {
					break
				}
				await new Promise((r) => setTimeout(r, 2000))
			}
		}
		poll()
		return () => {
			active = false
		}
	}, [getMemoryData])

	if (data.length === 0) {
		return <Text>Waiting for memory data...</Text>
	}

	const latest = data[data.length - 1]
	const maxRss = Math.max(...data.map((d) => d.rss))

	return (
		<Box flexDirection='column'>
			<Text bold>Memory Usage (MB)</Text>
			<Text>
				RSS: {formatMB(latest.rss)} | Heap Used: {formatMB(latest.heapUsed)} / {formatMB(latest.heapTotal)}
			</Text>
			<Box flexDirection='column' marginTop={1}>
				{data.map((snapshot, i) => {
					const heapRatio = maxRss > 0 ? snapshot.heapUsed / maxRss : 0
					const rssRatio = maxRss > 0 ? snapshot.rss / maxRss : 0
					const heapBar = '█'.repeat(Math.round(heapRatio * 30))
					const rssBar = '░'.repeat(Math.max(0, Math.round(rssRatio * 30) - heapBar.length))
					return (
						<Text key={i} color={heapRatio > 0.8 ? 'red' : heapRatio > 0.6 ? 'yellow' : 'cyan'}>
							{(heapBar + rssBar).padEnd(30, ' ')} {formatMB(snapshot.heapUsed)}
						</Text>
					)
				})}
			</Box>
			<Text dimColor>█ heapUsed ░ rss</Text>
		</Box>
	)
}

export default MemoryGraph
