const fs = require('fs-extra')
const path = require('path')
const prettier = require('prettier')
const yaml = require('yaml')

const { step } = require('./spinner')
const Scaffold = require('../scaffold')
const { generateEventIndexingHandlers } = require('../scaffold/mapping')
const { generateEventType, abiEvents } = require('../scaffold/schema')
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

const writeABI = async (abi, contractName, abiPath) => {
  let data = prettier.format(JSON.stringify(abi.data), {
    parser: 'json',
  })
  let filePath = abiPath ? abiPath : `./abis/${contractName}.json`

  await fs.writeFile(filePath, data, { encoding: 'utf-8' })
}

const writeSchema = async (abi, protocol) => {
  const events = protocol.hasEvents() ? abiEvents(abi).toJS() : []

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

const writeMapping = async (protocol, abi, contractName) => {
  const events = protocol.hasEvents()
    ? abiEvents(abi).toJS()
    : []

  let mapping = prettier.format(
    generateEventIndexingHandlers(
        events,
        contractName,
      ),
    { parser: 'typescript', semi: false },
  )

  await fs.writeFile(`./src/${toKebabCase(contractName)}.ts`, mapping, { encoding: 'utf-8' })
}

const toKebabCase = (anyString) => {
  return anyString
    .match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
    .map(x => x.toLowerCase())
    .join('-');
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
