const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
require("dotenv").config();
const cron = require("node-cron");
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

    app.get("/latest-vehicles", async (req, res) => {
      const cursor = vehiclesCollection.find().sort({createdAt:-1 }).limit(6);
      const result = await cursor.toArray();
      res.send(result);
    })
      

    app.get("/vehicles/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await vehiclesCollection.findOne(query);
      res.send(result);
    });

    app.post("/vehicles", async (req, res) => {
      const newVehicle ={...req.body, createdAt: new Date()}; ;
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

    cron.schedule("* * * * *", async () => {
  const now = new Date();
  try {
    const expiredBookings = await bookingsCollection.find({ returnDate: { $lte: now }, status: "Booked" }).toArray();

    for (const booking of expiredBookings) {
      
      await vehiclesCollection.updateOne(
        { _id: booking.vehicleId },
        { $set: { availability: "Available" } }
      );

      
      await bookingsCollection.updateOne(
        { _id: booking._id },
        { $set: { status: "Completed" } }
      );

      console.log(`Booking ${booking._id} completed. Vehicle is now available.`);
    }
  } catch (err) {
    console.error("Error in cron job:", err);
  }
});
// Get bookings with vehicle info
app.get("/my-bookings-details", async (req, res) => {
  try {
    const { email } = req.query; 
    if (!email) return res.status(400).json({ error: "Email is required" });

    const bookingsWithVehicle = await bookingsCollection
      .aggregate([
        { $match: { userEmail: email } }, 
        {
          $lookup: {
            from: "vehicles",           
            localField: "vehicleId",    
            foreignField: "_id",        
            as: "vehicleInfo",          
          },
        },
        { $unwind: "$vehicleInfo" },     
        {
          $project: {
            vehicleId: 1,
            vehicleName: 1,
            userEmail: 1, // Booking user's email
            bookingDate: 1,
            returnDate: 1,
            status: 1,
            bookFor: 1,
            "vehicleInfo.coverImage": 1,
            "vehicleInfo.owner": 1,
            "vehicleInfo.userEmail": 1, // <-- vehicle owner's email
            "vehicleInfo.category": 1,
            "vehicleInfo.fuelType": 1,
            "vehicleInfo.seatCapacity": 1,
          },
        },
      ])
      .toArray();

    res.status(200).json(bookingsWithVehicle);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch bookings with vehicle info" });
  }
});


   app.post("/bookings", async (req, res) => {
  try {
    const { vehicleId, userEmail, bookFor } = req.body;

    if (!vehicleId || !userEmail || !bookFor) {
      return res.status(400).json({ error: "vehicleId, userEmail, and bookFor are required" });
    }

    const vehicleObjectId = new ObjectId(vehicleId);
    const vehicle = await vehiclesCollection.findOne({ _id: vehicleObjectId });

    if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
    if (vehicle.availability !== "Available") {
      return res.status(400).json({ error: "Vehicle is not available" });
    }

    const returnDate = new Date(Date.now() + bookFor * 24 * 60 * 60 * 1000); 

    const newBooking = {
      vehicleId: vehicle._id,
      vehicleName: vehicle.vehicleName,
      userEmail,
      bookingDate: new Date(),
      bookFor,       
      returnDate,   
      status: "Booked",
    };

    const bookingResult = await bookingsCollection.insertOne(newBooking);

    
    await vehiclesCollection.updateOne(
      { _id: vehicle._id },
      { $set: { availability: "Booked" } }
    );

    res.status(201).json({ message: "Booking successful", booking: bookingResult });
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
// Temporary route to convert all prices to numbers
app.patch("/fix-prices", async (req, res) => {
  try {
    const vehicles = await vehiclesCollection.find({}).toArray();
    for (const vehicle of vehicles) {
      await vehiclesCollection.updateOne(
        { _id: vehicle._id },
        { $set: { pricePerDay: Number(vehicle.pricePerDay) } }
      );
    }
    res.status(200).json({ message: "All vehicle prices converted to numbers" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fix prices" });
  }
});


    //await client.db("admin").command({ ping: 1 });
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
