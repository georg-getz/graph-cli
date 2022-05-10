const fs = require('fs-extra')
const path = require('path')
const prettier = require('prettier')
const yaml = require('yaml')

const { step } = require('./spinner')
const Scaffold = require('../scaffold')
const { generateEventIndexingHandlers } = require('../scaffold/mapping')
const { generateEventType, abiEvents } = require('../scaffold/schema')
const { toKebabCase } = require('../codegen/util')
const { Map } = require('immutable')

const generateDataSource = async (protocol, contractName, network, contractAddress, abi) => {
  const protocolManifest = protocol.getManifestScaffold()

  return Map.of(
    'kind', protocol.name,
    'name', contractName,
    'network', network,
    'source', yaml.parse(prettier.format(protocolManifest.source({contract: contractAddress, contractName}),
      {parser: 'yaml'})),
    'mapping', yaml.parse(prettier.format(protocolManifest.mapping({abi, contractName}),
      {parser: 'yaml'}))
  ).asMutable()
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

const writeABI = async (abi, contractName, abiPath) => {
  let data = prettier.format(JSON.stringify(abi.data), {
    parser: 'json',
  })
  let filePath = abiPath ? abiPath : `./abis/${contractName}.json`

  await fs.writeFile(filePath, data, { encoding: 'utf-8' })
}

const writeSchema = async (abi, protocol, schemaPath) => {
  const events = protocol.hasEvents() ? abiEvents(abi).toJS() : []
  events.filter(event => entities.indexOf(event.get('name')) !== -1)

  let data = prettier.format(
    events.map(
        event => generateEventType(event, protocol.name)
      ).join('\n\n'),
    {
      parser: 'graphql',
    },
  )

  await fs.appendFile(schemaPath, data, { encoding: 'utf-8' })
}

const writeMapping = async (protocol, abi, contractName, entities) => {
  const events = protocol.hasEvents()
    ? abiEvents(abi).toJS()
    : []
  console.log('events before: ' + events)
  events.filter(event => entities.indexOf(event.get('name')) !== -1)
  console.log('events after: ' + events)

  let mapping = prettier.format(
    generateEventIndexingHandlers(
        events,
        contractName,
      ),
    { parser: 'typescript', semi: false },
  )

  await fs.writeFile(`./src/${toKebabCase(contractName)}.ts`, mapping, { encoding: 'utf-8' })
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
  generateDataSource,
  writeABI,
  writeSchema,
  writeMapping,
  toKebabCase
}
