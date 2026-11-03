import { Coordinate } from './Coordinate.js';

// Погода в місті зараз + прогноз. Це НАШ формат (DTO): фронтенд залежить лише від нього.
// Чужий формат OpenWeatherMap перекладається в наш один раз, у fromApi.
export class Weather {
  static fromApi(current, forecast) {
    return new Weather({
      city: current.name,
      country: current.sys.country,
      description: current.weather[0].description,
      icon: current.weather[0].icon,
      temp: current.main.temp,
      feelsLike: current.main.feels_like,
      humidity: current.main.humidity,
      pressure: current.main.pressure,
      windSpeed: current.wind.speed,
      coord: new Coordinate(current.coord.lat, current.coord.lon), // центр карти
      forecast,
    });
  }

  constructor({ city, country, description, icon, temp, feelsLike, humidity, pressure, windSpeed, coord, forecast }) {
    this.city = city;
    this.country = country;
    this.description = description;
    this.icon = icon;
    this.temp = temp;
    this.feelsLike = feelsLike;
    this.humidity = humidity;
    this.pressure = pressure;
    this.windSpeed = windSpeed;
    this.coord = coord;
    this.forecast = forecast; // DailyForecast[]
  }

  // JSON.stringify викликає цей метод сам: порядок полів відповіді API визначено тут
  toJSON() {
    return {
      city: this.city,
      country: this.country,
      description: this.description,
      icon: this.icon,
      temp: this.temp,
      feelsLike: this.feelsLike,
      humidity: this.humidity,
      pressure: this.pressure,
      windSpeed: this.windSpeed,
      coord: this.coord,
      forecast: this.forecast,
    };
  }
}
