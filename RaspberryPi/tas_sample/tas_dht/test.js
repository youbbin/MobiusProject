var sensor = require("node-dht-sensor");

sensor.read(11, 27, function(err, temperature, humidity) {
  if (!err) {
    console.log(`temp: ${temperature}°C, humidity: ${humidity}%`);
  } else{
    console.log('error');
  }
});