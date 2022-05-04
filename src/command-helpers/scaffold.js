const fs = require('fs-extra')
const path = require('path')
const prettier = require('prettier')

const { step } = require('./spinner')
const Scaffold = require('../scaffold')
const { generateEventType } = require('../scaffold/schema')
const { Map } = require('immutable')

const addDatasource = async (kind, name, network, source, mapping) => {
  return`  -kind: ${kind}
    name: ${name}
    network: ${network}
    source: ${source}
    mapping: ${mapping}
`
}

const addDatasource2 = async (kind, name, network, source, mapping) => {
  console.log("addD2 " + kind + '\n' + name + '\n' + network + '\n' + source + '\n' + mapping)
  return Map.of(
    'kind', kind,
    'name', name,
    'network', network,
    'source', source,
    'mapping', mapping
  )
}

const generateScaffold = async (
  {
    protocolInstance,
    abi,
    contract,
    network,
    subgraphName,
    indexEvents,
    contractName = 'Contract',
    node,
  },
  spinner,
) => {
  step(spinner, 'Generate subgraph')

  const scaffold = new Scaffold({
    protocol: protocolInstance,
    abi,
    indexEvents,
    contract,
    network,
    contractName,
    subgraphName,
    node,
  })

  return scaffold.generate()
}
  
const addABIs = async (contractName, abi) => {
  return {
      [`${contractName}.json`]: prettier.format(JSON.stringify(abi.data), {
        parser: 'json',
      }),
    }
}

const writeABI = async (abi, contractName) => {
  let data = prettier.format(JSON.stringify(abi.data), {
    parser: 'json',
  })
  await fs.writeFile(`./abis/${contractName}.json`, data, { encoding: 'utf-8' })
}

const writeSchema = async (abi, protocol) => {
  const events = abiEvents(abi).toJS()

  let data = prettier.format(
    events.map(
        event => generateEventType(event, protocol.name)
      ).join('\n\n'),
    {
      parser: 'graphql',
    },
  )

  await fs.appendFile('./schema.graphql', data, { encoding: 'utf-8' })
}

const writeScaffoldDirectory = async (scaffold, directory, spinner) => {
  // Create directory itself
  await fs.mkdirs(directory)

  let promises = Object.keys(scaffold).map(async basename => {
    let content = scaffold[basename]
    let filename = path.join(directory, basename)

    // Write file or recurse into subdirectory
    if (typeof content === 'string') {
      await fs.writeFile(filename, content, { encoding: 'utf-8' })
    } else if (content == null) {
      return // continue loop
    } else {
      writeScaffoldDirectory(content, path.join(directory, basename), spinner)
    }
  })

  await Promise.all(promises)
}

const writeScaffold = async (scaffold, directory, spinner) => {
  step(spinner, `Write subgraph to directory`)
  await writeScaffoldDirectory(scaffold, directory, spinner)
}

module.exports = {
  ...module.exports,
  generateScaffold,
  writeScaffold,
  addDatasource,
  addDatasource2,
  writeABI,
  writeSchema
}
