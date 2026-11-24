# huddle

## Deploy to Render

Create a Blueprint from this repository; `render.yaml` configures the Node web service and generates `SESSION_SECRET`. Set `MONGODB_URI` privately in Render to your MongoDB Atlas connection string.

`npm run seed` clears the Huddle collections before loading demo data. Only run it against a disposable demo database.
