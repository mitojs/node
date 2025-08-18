/** biome-ignore-all lint/suspicious/noArrayIndexKey: <explanation> */

import { Box, Text } from 'ink'
import type React from 'react'
import { useEffect, useState } from 'react'

interface CPUGraphProps {
	pid: number
}

// 采集CPU数据的函数（实际建议用pidusage等库，这里用Math.random演示）
function getCPUPercent(pid: number): number {
	return Math.random() * 100
}

const CPUGraph: React.FC<CPUGraphProps> = ({ pid }) => {
	const [data, setData] = useState<number[]>([])
	useEffect(() => {
		const interval = setInterval(() => {
			setData((prev) => {
				const next = [...prev, getCPUPercent(pid)]
				if (next.length > 50) next.shift()
				return next
			})
		}, 500)
		return () => clearInterval(interval)
	}, [pid])
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
