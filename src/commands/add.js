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
      let result = updateEventNamesOnCollision(ethabi, entities, contractName)
      hasCollisions = result.hasCollisions
      if (!mergeEntities) {
        ethabi.data = result.abiData
        await writeABI(ethabi, contractName, abi)
      }
    } else {
      if (network === 'poa-core') {
        ethabi = await loadAbiFromBlockScout(EthereumABI, network, address)
      } else {
        ethabi = await loadAbiFromEtherscan(EthereumABI, network, address)
      }

      let result = updateEventNamesOnCollision(ethabi, entities, contractName)
      hasCollisions = result.hasCollisions
      if (!mergeEntities) {
        ethabi.data = result.abiData
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
      contractName, network, address, ethabi)
    if (mergeEntities && hasCollisions) {
      let firstDataSource = dataSources.get(0)
      // console.log('firstDs: ' + firstDataSource)
      let dsMapping = dataSource.get('mapping')
      let source = dataSource.get('source')
      console.log(source + '\nSource^ mapping > ' + dsMapping)
      console.log(dataSource.source)
      let mapping = firstDataSource.get('mapping').asMutable()
      // let source = firstDataSource.get('source')
      // console.log('ent: ' + dsMapping.entities + dsMapping.abi + firstDataSource.get('source').get('abi'))
      mapping.set('entities', dsMapping.entities)
      source.set('abi', firstDataSource.get('source').get('abi'))


      
      // mapping.eventHandlers = []
      // mapping.blockHandlers = []
      // mapping.callHandlers = []

      // // Make sure data source has at least 1 mapping
      // console.log('ev: ' + firstDataSource.get('mapping').get('eventHandlers')
      //             + '\nbl: ' + firstDataSource.get('mapping').get('blockHandlers')
      //             + '\ncl: ' + firstDataSource.get('mapping').get('callHandlers'))
      // if (firstDataSource.eventHandlers) {
      //   mapping.eventHandlers = [firstDataSource.get('mapping').get('eventHandlers').get(0)]
      // } else if (firstDataSource.blockHandlers) {
      //   mapping.blockHandlers = [firstDataSource.get('mapping').get('blockHandlers').get(0)]
      // } else {
      //   mapping.callHandlers = [firstDataSource.get('mapping').get('callHandlers').get(0)]
      // }

      // mapping.file = firstDataSource.get('mapping').get('file')
      dataSource.set('mapping', mapping)
      dataSource.set('source', source)
      console.log('mapping: ' + mapping + '\nds: ' + dataSource)
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
