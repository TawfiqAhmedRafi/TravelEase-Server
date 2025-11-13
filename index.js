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
    const bookingsCollection = db.collection("bookings");
    const usersCollection = db.collection("users");

    app.post('/users', async(req, res)=>{
      const newUser = req.body;

      const email= req.body.email;
      const query = {email: email};
      const existingUser = await usersCollection.findOne(query);
      if(existingUser){
        return res.send({message: 'User already exists'});
      }
      else{
        const result = await usersCollection.insertOne(newUser);
      res.send(result);
      }
      
    })

    app.get("/vehicles", async (req, res) => {
      try {
        const { category, location, sortBy, order, limit, email ,availability  } = req.query;
        const query = {};
        if (category) query.category = category;
        if (location) query.location = { $regex: location, $options: "i" };
        const sort = {};
        if (sortBy) {
          sort[sortBy] = order === "asc" ? 1 : -1;
        }
        if (email) {
          query.userEmail = email;
        }
        if( availability){
          query.availability = availability;
        }

        const cursor = vehiclesCollection.find(query).sort(sort);
        if (limit) {
          cursor = cursor.limit(parseInt(limit));
        }
        const vehicles = await cursor.toArray();
        res.status(200).json(vehicles);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch vehicles" });
      }
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
        $set: updatedVehicle,
      };
      const result = await vehiclesCollection.updateOne(query, update);
      res.send(result);
    });

    app.delete("/vehicles/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await vehiclesCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      try {
        const { email } = req.query;
        const query = email ? { userEmail: email } : {};
        const bookings = await bookingsCollection.find(query).toArray();
        res.status(200).json(bookings);
      } catch (err) {
        console.error("Error fetching bookings:", err);
        res.status(500).json({ error: "Failed to fetch bookings" });
      }
    });
    app.post("/bookings", async (req, res) => {
      try {
        const { vehicleId, userEmail } = req.body;
        if (!vehicleId || !userEmail) {
          return res
            .status(400)
            .json({ error: "vehicleId and userEmail are required" });
        }
        const vehicleObjectId = new ObjectId(vehicleId);
        const vehicle = await vehiclesCollection.findOne({
          _id: vehicleObjectId,
        });
        if (!vehicle)
          return res.status(404).json({ error: "Vehicle not found" });
        if (vehicle.availability !== "Available") {
          return res.status(400).json({ error: "Vehicle is not available" });
        }
        const newBooking = {
          vehicleId: vehicle._id,
          vehicleName: vehicle.vehicleName,
          userEmail,
          bookingDate: new Date(),
          status: "Booked",
        };
        const bookingResult = await bookingsCollection.insertOne(newBooking);
        await vehiclesCollection.updateOne(
          { _id: vehicle._id },
          { $set: { availability: "Booked" } }
        );
        res
          .status(201)
          .json({ message: "Booking successful", booking: bookingResult });
      } catch (err) {
        console.error("Error adding booking:", err);
        res.status(500).json({ error: "Failed to add booking" });
      }
    });

app.delete("/bookings", async (req, res) => {
  try {
    const { vehicleId, userEmail } = req.query;

    if (!vehicleId || !userEmail) {
      return res.status(400).json({ error: "vehicleId and userEmail are required" });
    }

    const vehicleObjectId = new ObjectId(vehicleId);

   
    const booking = await bookingsCollection.findOne({
      vehicleId: vehicleObjectId,
      userEmail,
    });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    
    await bookingsCollection.deleteOne({ _id: booking._id });

    
    await vehiclesCollection.updateOne(
      { _id: vehicleObjectId },
      { $set: { availability: "Available" } }
    );

    res.status(200).json({ message: "Booking cancelled successfully" });
  } catch (err) {
    console.error("Error cancelling booking:", err);
    res.status(500).json({ error: "Failed to cancel booking" });
  }
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
