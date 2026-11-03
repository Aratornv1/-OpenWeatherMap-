// Прогноз на один день. Форма відповіді API визначена в toJSON (порядок полів зафіксовано).
export class DailyForecast {
  constructor({ date, min, max, humidity, icon, description }) {
    this.date = date; // 'YYYY-MM-DD' за місцевим часом міста
    this.min = min;
    this.max = max;
    this.humidity = humidity;
    this.icon = icon;
    this.description = description;
  }

  toJSON() {
    return {
      date: this.date,
      min: this.min,
      max: this.max,
      humidity: this.humidity,
      icon: this.icon,
      description: this.description,
    };
  }
}
