const chalk = require('chalk')
const toolbox = require('gluegun/toolbox')
const { withSpinner } = require('../command-helpers/spinner')
const Subgraph = require('../subgraph')
const Protocol = require('../protocols')
const DataSourcesExtractor = require('../command-helpers/data-sources')
const { abiEvents, generateScaffold, writeScaffold } = require('../scaffold')
const { addDatasource2, writeABI, writeSchema } = require('../command-helpers/scaffold')
const Compiler = require('../compiler')
const { List, Map } = require('immutable')
const { loadAbiFromEtherscan } = require('./init')
const EthereumABI = require('../protocols/ethereum/abi')

const help = `
${chalk.bold('graph add')} <address> [<subgraph-manifest default: "./subgraph.yaml">]

${chalk.dim('Options:')}

      --abi <path>              Path to the contract ABI (default: download from Etherscan)
      --index-events            Index contract events as entities
      --contract-name           Name of the contract (default: Contract)
      --merge-entities          Whether to merge entities with the same name (default: false)
  -h, --help                    Show usage information
`

module.exports = {
  description: 'Creates a new subgraph with basic scaffolding',
  run: async toolbox => {
    // Obtain tools
    let { print, system } = toolbox

    // Read CLI parameters
    let {
      abi,
      contractName,
      h,
      help,
      indexEvents,
      mergeEntities
    } = toolbox.parameters.options
    let address = toolbox.parameters.first//0xC75650fe4D14017b1e12341A97721D5ec51D5340

    // Validate the subgraph name
    if (!address) {
      print.error('No contract address provided')
      process.exitCode = 1
      return
    }

    indexEvents = true
    contractName = contractName ? contractName : 'Contract'
    let ethabi = null
    if (!abi) {
      ethabi = await loadAbiFromEtherscan(EthereumABI, 'mainnet', address)
      await writeABI(ethabi, contractName)
    }
    console.log(ethabi)
    const dataSourcesAndTemplates = await DataSourcesExtractor.fromFilePath('subgraph.yaml')

    let protocol = Protocol.fromDataSources(dataSourcesAndTemplates)
    if (indexEvents) {
      writeSchema(ethabi, protocol)
    }

    let manifest = await Subgraph.load('subgraph.yaml', {protocol: protocol})
    let result = manifest.result.asMutable()

    let ds = result.get('dataSources')
    let wat = (await addDatasource2(protocol, 
      contractName, 'mainnet', address, ethabi))
    console.log('wat: ' + wat);
    result.set('dataSources', ds.push(wat))
    await Subgraph.write(result, 'subgraph.yaml')
    manifest = await Subgraph.load('subgraph.yaml', {protocol: protocol})
    ds = manifest.result.get('dataSources')
    for (let [i, dataSource] of ds.entries()) {
      console.log(i + '\n' + dataSource)
    }
    // if (help || h) {
    //   print.info(HELP)
    //   return
    // }

    // // Detect git
    // let git = await system.which('git')
    // if (git === null) {
    //   print.error(
    //     `Git was not found on your system. Please install 'git' so it is in $PATH.`,
    //   )
    //   process.exitCode = 1
    //   return
    // }

    // // Detect Yarn and/or NPM
    // let yarn = await system.which('yarn')
    // let npm = await system.which('npm')
    // if (!yarn && !npm) {
    //   print.error(
    //     `Neither Yarn nor NPM were found on your system. Please install one of them.`,
    //   )
    //   process.exitCode = 1
    //   return
    // }

    // let commands = {
    //   install: yarn ? 'yarn' : 'npm install',
    //   codegen: yarn ? 'yarn codegen' : 'npm run codegen',
    // }
  },
}

