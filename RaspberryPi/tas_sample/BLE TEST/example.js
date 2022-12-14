require('dotenv').config()

const { createBluetooth } = require('node-ble')
const { TEST_DEVICE, TEST_SERVICE, TEST_CHARACTERISTIC, TEST_NOTIFY_SERVICE, TEST_NOTIFY_CHARACTERISTIC } = process.env

async function main () {
  const { bluetooth, destroy } = createBluetooth()

  // get bluetooth adapter
  const adapter = await bluetooth.defaultAdapter()
  await adapter.startDiscovery()
  console.log('discovering')

  // get device and connect
  const device = await adapter.waitDevice(TEST_DEVICE)
  console.log('got device', await device.getAddress(), await device.getName())
  await device.connect()
  console.log('connected')

  const gattServer = await device.gatt()

  // read write characteristic
  const service1 = await gattServer.getPrimaryService(TEST_SERVICE)
  const characteristic1 = await service1.getCharacteristic(TEST_CHARACTERISTIC)
  console.log('write characteristic ok')
  //await characteristic1.writeValue(Buffer.from('Hello world'))
  //const buffer = await characteristic1.readValue()
  //console.log('read', buffer, buffer.toString())

  await characteristic2.stopNotifications()
  destroy()
}

main()
  .then(console.log)
  .catch(console.error)
