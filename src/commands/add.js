const chalk = require('chalk')
const fs = require('fs-extra')
const toolbox = require('gluegun/toolbox')
const prettier = require('prettier')
const immutable = require('immutable')
const { withSpinner } = require('../command-helpers/spinner')
const Subgraph = require('../subgraph')
const Protocol = require('../protocols')
const DataSourcesExtractor = require('../command-helpers/data-sources')
const { abiEvents, generateScaffold, writeScaffold } = require('../scaffold')
const { addDatasource2, writeABI, writeSchema, writeMapping } = require('../command-helpers/scaffold')
const Compiler = require('../compiler')
const { List, Map } = require('immutable')
const { loadAbiFromEtherscan } = require('./init')
const EthereumABI = require('../protocols/ethereum/abi')
const { fixParameters } = require('../command-helpers/gluegun')

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

    // Validate the address
    if (!address) {
      print.error('No contract address provided')
      process.exitCode = 1
      return
    }

    try {
      fixParameters(toolbox.parameters, {
        h,
        help,
        indexEvents,
        mergeEntities,
      })
    } catch (e) {
      print.error(e.message)
      process.exitCode = 1
      return
    }

    const dataSourcesAndTemplates = await DataSourcesExtractor.fromFilePath('subgraph.yaml').toJS()
    let list = []
    console.log(dataSourcesAndTemplates)
    for (let i = 0; i < dataSourcesAndTemplates.length; i++) {
      let datasource = dataSourcesAndTemplates[i]
      console.log('datasource: ' + datasource)
      list.concat(datasource.mapping.entities)

    }
    console.log(list)
    console.log(dataSourcesAndTemplates)
    indexEvents = true
    contractName = contractName ? contractName : 'Contract'
    let ethabi = null
    if (abi) {
      ethabi = EthereumABI.load(contractName, abi)
      // if (!mergeEntities) {
        let kek = ethabi.data.asMutable()
        // kek.filter(item => item.get('type') === 'event').map(event => {
        //   event = event.asMutable()
        //   console.log('event ' + contractName + event.get('name'))
        //   event.set('name', contractName + event.get('name'))
        //   console.log('after: ' + event.get('name'))
        //   return event
        // });
        for (let i = 0; i < kek.size; i++) {
          let lek = kek.get(i).asMutable()
          if (lek.get('type') === 'event') {
            console.log('lek: ' + lek)
            lek.set('name', contractName + lek.get('name'))
          }
          kek.set(i, lek)
          ethabi.data = kek
        }
        console.log('\nkek: ' + kek.filter(item => item.get('type') === 'event'))
        // ethabi.data.asMutable().filter(item => item.get('type') === 'event').forEach(event => {
        //   console.log('event ' + contractName + event.get('name'))
        //   event.set('name', contractName + event.get('name'))
        //   console.log('after: ' + event.get('name'))
        // })
        console.log('\n\n\n' + ethabi.data.filter(item => item.get('type') === 'event'))
        await writeABI(ethabi, contractName, abi)
      // }
      // ethabi = new EthereumABI(contractName, await JSON.parse(fs.readFile(abi, 'utf-8')))
    } else {
      ethabi = await loadAbiFromEtherscan(EthereumABI, 'mainnet', address)
      if (!mergeEntities) {
        ethabi.data.filter(item => item.get('type') === 'event').map(event => {
          console.log(event)
          event.set('name', contractName + event.get('name'))
        })
      }
      await writeABI(ethabi, contractName, undefined)
    }


    let protocol = Protocol.fromDataSources(dataSourcesAndTemplates)
    if (indexEvents) {
      writeSchema(ethabi, protocol)
      writeMapping(protocol, ethabi, contractName)
    }

    let manifest = await Subgraph.load('subgraph.yaml', {protocol: protocol})
    let result = manifest.result.asMutable()

    let ds = result.get('dataSources')
    let wat = await addDatasource2(protocol, 
      contractName, 'mainnet', address, ethabi)
    console.log('wat: ' + wat);
    result.set('dataSources', ds.push(wat))
    await Subgraph.write(result, 'subgraph.yaml')
    manifest = await Subgraph.load('subgraph.yaml', {protocol: protocol})
    ds = manifest.result.get('dataSources')
    for (let [i, dataSource] of ds.entries()) {
      console.log(i + '\n' + dataSource)
    }


    // Detect Yarn and/or NPM
    let yarn = await system.which('yarn')
    let npm = await system.which('npm')
    if (!yarn && !npm) {
      print.error(
        `Neither Yarn nor NPM were found on your system. Please install one of them.`,
      )
      process.exitCode = 1
      return
    }

    await toolbox.system.run(yarn ? 'yarn codegen' : 'npm run codegen')
  }
}

