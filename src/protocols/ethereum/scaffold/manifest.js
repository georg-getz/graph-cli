const { abiEvents } = require('../../../scaffold/schema')
const ABI = require('../abi')

const source = ({ contract, contractName }) => `
      address: '${contract}'
      abi: ${contractName}`

const mapping = ({ abi, contractName }) => `
      kind: ethereum/events
      apiVersion: 0.0.5
      language: wasm/assemblyscript
      entities:
        ${abiEvents(abi)
          .map(event => `- ${event.get('_alias')}`)
          .join('\n        ')}
      abis:
        - name: ${contractName}
          file: ./abis/${contractName}.json
      eventHandlers:
        ${abiEvents(abi)
          .map(
            event => `
        - event: ${ABI.eventSignature(event)}
          handler: handle${event.get('_alias')}`,
          )
          .join('')}
      file: ./src/${toKebabCase(contractName)}.ts`

const toKebabCase = (contractName) => {
  return contractName
    .match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
    .map(x => x.toLowerCase())
    .join('-');
}

module.exports = {
  source,
  mapping,
}
