const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.eemz9pt.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.send("Smart Server is running");
});

async function run() {
  try {
    await client.connect();

    const db = client.db(process.env.DB_NAME);
    const vehiclesCollection = db.collection("vehicles");

    app.get("/vehicles", async (req, res) => {
      const cursor = vehiclesCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/vehicles/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await vehiclesCollection.findOne(query);
      res.send(result);
    });

    app.post("/vehicles", async (req, res) => {
      const newVehicle = req.body;
      const result = await vehiclesCollection.insertOne(newVehicle);
      res.send(result);
    });

    app.patch("/vehicles/:id", async (req, res) => {
      const id = req.params.id;
       const updatedVehicle = req.body;
      const query = { _id: new ObjectId(id) };
      const update = {
        $set:updatedVehicle
      }
      const result = await vehiclesCollection.updateOne(query, update);
      res.send(result);
     
      })

    app.delete("/vehicles/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await vehiclesCollection.deleteOne(query);
      res.send(result);
    });
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Smart Server is running on port : ${port}`);
});
