/** biome-ignore-all lint/suspicious/noArrayIndexKey: <explanation> */

import { Box, Text } from 'ink'
import type React from 'react'
import { useEffect, useState } from 'react'

interface CPUGraphProps {
	getCPUData: () => Promise<number>
}

const CPUGraph: React.FC<CPUGraphProps> = ({ getCPUData }) => {
	const [data, setData] = useState<number[]>([])
	useEffect(() => {
		let active = true
		const poll = async () => {
			while (active) {
				try {
					const cpuPercent = await getCPUData()
					setData((prev) => {
						const next = [...prev, cpuPercent]
						if (next.length > 50) next.shift()
						return next
					})
				} catch {
					break
				}
				await new Promise((r) => setTimeout(r, 1000))
			}
		}
		poll()
		return () => {
			active = false
		}
	}, [getCPUData])
	const max = 100
	return (
		<Box flexDirection='column'>
			<Text>CPU Usage (%)</Text>
			<Box flexDirection='column'>
				{data.map((v, i) => {
					const bar = '█'.repeat(Math.round((v / max) * 20))
					return (
						<Text key={i} color={v > 80 ? 'red' : v > 50 ? 'yellow' : 'green'}>
							{bar.padEnd(20, ' ')} {v.toFixed(1)}
						</Text>
					)
				})}
			</Box>
		</Box>
	)
}

export default CPUGraph
