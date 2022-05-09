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
const { generateDataSource, writeABI, writeSchema, writeMapping } = require('../command-helpers/scaffold')
const Compiler = require('../compiler')
const { List, Map } = require('immutable')
const { loadAbiFromEtherscan, loadAbiFromBlockScout } = require('./init')
const EthereumABI = require('../protocols/ethereum/abi')
const { fixParameters } = require('../command-helpers/gluegun')

const help = `
${chalk.bold('graph add')} <address> [<subgraph-manifest default: "./subgraph.yaml">]

${chalk.dim('Options:')}

      --abi <path>              Path to the contract ABI (default: download from Etherscan)
      --index-events            Index contract events as entities (default: true)
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

    let address = toolbox.parameters.first
    contractName = contractName ? contractName : 'Contract'

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
    indexEvents = true //why not always true?   

    const dataSourcesAndTemplates = await DataSourcesExtractor.fromFilePath('subgraph.yaml')
    let protocol = Protocol.fromDataSources(dataSourcesAndTemplates)
    let manifest = await Subgraph.load('subgraph.yaml', {protocol: protocol})
    let network = manifest.result.get('dataSources').get(0).get('network')
    let entities = getEntities(manifest)

    console.log(entities)
    let ethabi = null
    let hasCollisions = null
    if (abi) {
      ethabi = EthereumABI.load(contractName, abi)
      if (!mergeEntities) {
        let result = updateEventNamesOnCollision(ethabi, entities, contractName)
        ethabi.data = result.abiData
        hasCollisions = result.hasCollisions
        await writeABI(ethabi, contractName, abi)
      }
    } else {
      if (network === 'poa-core') {
        ethabi = await loadAbiFromBlockScout(EthereumABI, network, address)
      } else {
        ethabi = await loadAbiFromEtherscan(EthereumABI, network, address)
      }

      if (!mergeEntities) {
        let result = updateEventNamesOnCollision(ethabi, entities, contractName)
        ethabi.data = result.abiData
        hasCollisions = result.hasCollisions
      }
      await writeABI(ethabi, contractName, undefined)
    }

    if (indexEvents && !mergeEntities) {
      writeSchema(ethabi, protocol)
      writeMapping(protocol, ethabi, contractName)
    }

    let result = manifest.result.asMutable()
    let dataSources = result.get('dataSources')
    let dataSource = await generateDataSource(protocol, 
      contractName, network, address, ethabi).asMutable()

    if (mergeEntities && hasCollisions) {
      let firstDataSource = dataSources.get(0)
      let mapping = dataSource.get('mapping').asMutable()
      
      mapping.eventHandlers = []
      mapping.blockHandlers = []
      mapping.callHandlers = []

      // Make sure data source has at least 1 mapping
      if (firstDataSource.eventHandlers) {
        mapping.eventHandlers = [firstDataSource.eventHandlers[0]]
      } else if (firstDataSource.blockHandlers) {
        mapping.blockHandlers = [firstDataSource.blockHandlers[0]]
      } else {
        mapping.callHandlers = [firstDataSource.callHandlers[0]]
      }

      mapping.file = firstDataSource.file
      dataSource.set('mapping', mapping)
    }

    result.set('dataSources', dataSources.push(dataSource))

    await Subgraph.write(result, 'subgraph.yaml')
    manifest = await Subgraph.load('subgraph.yaml', {protocol: protocol})

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

const getEntities = (manifest) => {
  let list = []
  manifest.result.get('dataSources').map(dataSource => {
    dataSource.getIn(['mapping', 'entities']).map(entity => {
      list.push(entity)
    })
  })
  manifest.result.get('templates').map(dataSource => {
    dataSource.getIn(['mapping', 'entities']).map(entity => {
      list.push(entity)
    })
  })
  return list
}

const updateEventNamesOnCollision = (ethabi, entities, contractName) => {
  let abiData = ethabi.data.asMutable()
  let { print } = toolbox
  let hasCollisions = false

  for (let i = 0; i < abiData.size; i++) {
    let dataRow = abiData.get(i).asMutable()
    
    if (dataRow.get('type') === 'event' && entities.indexOf(dataRow.get('name')) !== -1) {
      if (entities.indexOf(contractName + dataRow.get('name')) !== -1) {
        print.error(`Contract name ('${contractName}') 
          + event name ('${dataRow.get('name')}') entity already exists.`)
        process.exitCode = 1
        return
      }
      hasCollisions = true
      dataRow.set('name', contractName + dataRow.get('name'))
    }
    abiData.set(i, dataRow)
  }
  return { abiData, hasCollisions}
}
