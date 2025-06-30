#!/usr/bin/env node
import { program } from 'commander'
import { CLI } from './cli'

interface CmdOptions {
	pid: string
	port: string
	alinode: boolean
	aliyunnest: boolean
	cmddir: string
	cmdduration: string
	cmdfile: string
	cmdcode: string
}

const cmds: { cmd: string; [key: string]: any }[] = []

console.log('123')

program
	.option('-p, --pid <pid>', 'process id of the target process')
	.option('--port <port>', 'inspector port of the target process', '9229')
	.option('--alinode', 'is alinode runtime', false)
	.option('--aliyunnest', 'is aliyun nest environment', false)

program
	.command('cpuprofile')
	.description('get cpuprofile of the target process')
	.option('-d, --duration <duration>', 'cpuprofile duration', '10000')
	.action((options) => {
		cmds.push({
			cmd: 'cpuprofile',
			...options,
		})
	})

program
	.command('heapsnapshot')
	.description('get heapsnapshot of the target process')
	.option('-d, --dir <dir>', 'heapsnapshot file store dir', process.cwd())
	.action((options) => {
		cmds.push({
			cmd: 'heapsnapshot',
			...options,
		})
	})

program
	.command('report')
	.description('get report of the target process')
	.option('-d, --dir <dir>', 'report file store dir', process.cwd())
	.action((options) => {
		cmds.push({
			cmd: 'report',
			...options,
		})
	})

program
	.command('memory')
	.description('get memory info of the target process')
	.action(() => {
		cmds.push({
			cmd: 'memory',
		})
	})

program
	.command('startInspect')
	.description('start inspect the target process')
	.action(() => {
		cmds.push({
			cmd: 'startInspect',
		})
	})

program
	.command('stopInspect')
	.description('stop inspect the target process')
	.action(() => {
		cmds.push({
			cmd: 'stopInspect',
		})
	})

program
	.command('runCode')
	.description('run code in the target process')
	.option('-f, --file <code>', 'run code from file')
	.option('-c, --code <code>', 'run code from string')
	.action((options) => {
		cmds.push({
			cmd: 'runCode',
			...options,
		})
	})

program.parse(process.argv)

const options = program.opts<CmdOptions>()

const cli = new CLI({
	pid: Number(options.pid),
	port: Number(options.port),
	cmds,
})

cli.run()
