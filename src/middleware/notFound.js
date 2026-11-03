// Невідомий маршрут отримує JSON, як і решта API.
export function notFound(req, res) {
  return res.status(404).json({
    message: 'Маршрут не знайдено'
  });
}
