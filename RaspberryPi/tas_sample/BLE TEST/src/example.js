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
  var packet="0211FF0000000003"

  await characteristic1.writeValue(Buffer.from(hexStringToByteArray(packet)))
  //const buffer = await characteristic1.readValue()
  //console.log('read', buffer, buffer.toString())
  await device.disconnect()
  destroy()
}

function hexStringToByteArray(hexString) {
  if (hexString.length % 2 !== 0) {
      throw "Must have an even number of hex digits to convert to bytes";
  }/* w w w.  jav  a2 s .  c o  m*/
  var numBytes = hexString.length / 2;
  var byteArray = new Uint8Array(numBytes);
  for (var i=0; i<numBytes; i++) {
      byteArray[i] = parseInt(hexString.substr(i*2, 2), 16);
  }
  return byteArray;
}


main();
