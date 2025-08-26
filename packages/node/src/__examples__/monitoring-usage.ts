import { CPUSubject, MemorySubject } from '../subjects'

// Example usage of the refactored subjects

// Create CPU monitoring subject
const cpuSubject = new CPUSubject({ interval: 1000 })

// Create Memory monitoring subject
const memorySubject = new MemorySubject({ interval: 2000 })

// Subscribe to CPU data
cpuSubject.subscribe((cpuData) => {
	console.log('CPU Data:', {
		load: cpuData.load.toFixed(2) + '%',
		userLoad: cpuData.useLoad.toFixed(2) + '%',
	})
})

// Subscribe to Memory data
memorySubject.subscribe((memoryData) => {
	console.log('Memory Data:', {
		heapUsed: (memoryData.memory.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
		heapTotal: (memoryData.memory.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
		rss: (memoryData.memory.rss / 1024 / 1024).toFixed(2) + ' MB',
	})
})

// Start monitoring
cpuSubject.start()
memorySubject.start()

// Update intervals after 5 seconds
setTimeout(() => {
	console.log('Updating intervals...')
	cpuSubject.updateAndRestart({ interval: 500 })
	memorySubject.updateAndRestart({ interval: 1500 })
}, 5000)

// Cleanup after 10 seconds
setTimeout(() => {
	console.log('Cleaning up...')
	cpuSubject.teardown()
	memorySubject.teardown()
}, 10000)
