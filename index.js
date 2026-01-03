const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
require("dotenv").config();
const cron = require("node-cron");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");

//const serviceAccount = require("./travelease-ced9c-firebase-adminsdk-fbsvc-531a48b1da.json");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
// middleware
app.use(cors());
app.use(express.json());
// Firebase token verification middleware
const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized access , no token" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    console.error("Firebase token verification error:", err);
    return res
      .status(401)
      .send({ message: "Unauthorized access , invalid token" });
  }
};
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
    const reviewsCollection = db.collection("reviews");

    app.post("/users", async (req, res) => {
      const newUser = req.body;

      const email = req.body.email;
      const query = { email: email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists" });
      } else {
        const result = await usersCollection.insertOne(newUser);
        res.send(result);
      }
    });

    app.get("/vehicles", async (req, res) => {
      try {
        const {
          category,
          location,
          sortBy,
          order = "desc",
          limit = 10,
          page = 1,
          email,
          availability,
        } = req.query;

        const query = {};

        if (category) query.category = category;
        if (location) query.location = { $regex: location, $options: "i" };
        if (email) query.userEmail = email;
        if (availability) query.availability = availability;

        const sort = {};
        if (sortBy) {
          sort[sortBy] = order === "asc" ? 1 : -1;
        }

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const total = await vehiclesCollection.countDocuments(query);

        const vehicles = await vehiclesCollection
          .find(query)
          .sort(sort)
          .skip(skip)
          .limit(limitNum)
          .toArray();

        res.status(200).json({
          data: vehicles,
          pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum),
          },
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch vehicles" });
      }
    });

    app.get("/latest-vehicles", async (req, res) => {
      const cursor = vehiclesCollection.find().sort({ createdAt: -1 }).limit(6);
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
      const newVehicle = { ...req.body, createdAt: new Date() };
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

    app.post("/run-cron", async (req, res) => {
      const now = new Date();
      try {
        const expiredBookings = await bookingsCollection
          .find({ returnDate: { $lte: now }, status: "Booked" })
          .toArray();

        for (const booking of expiredBookings) {
          await vehiclesCollection.updateOne(
            { _id: new ObjectId(booking.vehicleId) },
            { $set: { availability: "Available" } }
          );

          await bookingsCollection.updateOne(
            { _id: new ObjectId(booking._id) },
            { $set: { status: "Completed" } }
          );

          console.log(
            `Booking ${booking._id} completed. Vehicle is now available.`
          );
        }

        res.status(200).json({ message: "Cron logic executed successfully" });
      } catch (err) {
        console.error("Error in cron logic:", err);
        res.status(500).json({ error: "Cron logic failed" });
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
        res
          .status(500)
          .json({ error: "Failed to fetch bookings with vehicle info" });
      }
    });

    app.patch("/bookings", async (req, res) => {
      try {
      } catch (err) {
        console.error("Error patching booking:", err);
        res.status(500).json({ error: "Failed to add booking" });
      }
    });

    app.post("/bookings", async (req, res) => {
      try {
        const { vehicleId, userEmail, bookFor, bookForHours } = req.body;

        if (!vehicleId || !userEmail || (!bookFor && !bookForHours)) {
          return res.status(400).json({
            error: "vehicleId, userEmail, and booking duration are required",
          });
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

        let returnDate;
        let durationHours = 0;

        if (bookForHours) {
          durationHours = Number(bookForHours);
          returnDate = new Date(Date.now() + durationHours * 60 * 60 * 1000);
        } else {
          durationHours = Number(bookFor) * 24;
          returnDate = new Date(Date.now() + durationHours * 60 * 60 * 1000);
        }

        const newBooking = {
          vehicleId: vehicle._id,
          vehicleName: vehicle.vehicleName,
          userEmail,
          bookingDate: new Date(),
          bookForDays: bookFor ? Number(bookFor) : null,
          bookForHours: bookForHours ? Number(bookForHours) : null,
          totalHours: durationHours,
          returnDate,
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
    app.patch("/bookings/:bookingId/complete", async (req, res) => {
      try {
        const { bookingId } = req.params;

        if (!ObjectId.isValid(bookingId)) {
          return res.status(400).json({ error: "Invalid booking ID" });
        }
        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(bookingId),
        });

        if (!booking) {
          return res.status(404).json({ error: "Booking not found" });
        }

        if (booking.status === "Completed") {
          return res.status(400).json({ error: "Booking already completed" });
        }
        await bookingsCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          { $set: { status: "Completed" } }
        );

        const vehicleId = booking.vehicleId;
        await vehiclesCollection.updateOne(
          { _id: new ObjectId(vehicleId) },
          { $set: { availability: "Available" } }
        );

        res.json({
          message: "Booking marked as completed and vehicle is now available",
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
      }
    });
    app.delete("/bookings", async (req, res) => {
      try {
        const { vehicleId, userEmail } = req.query;

        if (!vehicleId || !userEmail) {
          return res
            .status(400)
            .json({ error: "vehicleId and userEmail are required" });
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

    app.patch("/fix-prices", async (req, res) => {
      try {
        const vehicles = await vehiclesCollection.find({}).toArray();
        for (const vehicle of vehicles) {
          await vehiclesCollection.updateOne(
            { _id: vehicle._id },
            { $set: { pricePerDay: Number(vehicle.pricePerDay) } }
          );
        }
        res
          .status(200)
          .json({ message: "All vehicle prices converted to numbers" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fix prices" });
      }
    });

    // stats
    app.get("/stats", async (req, res) => {
      try {
        const totalVehicles = await vehiclesCollection.estimatedDocumentCount();
        const totalBookings = await bookingsCollection.estimatedDocumentCount();

        res.send({
          totalVehicles,
          totalBookings,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load statistics" });
      }
    });
    // review API
    app.post("/reviews", verifyFBToken, async (req, res) => {
      try {
        const review = {
          ...req.body,
          createdAt: new Date(),
        };

        const result = await reviewsCollection.insertOne(review);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to post review" });
      }
    });
    app.get("/reviews", async (req, res) => {
      try {
        const reviews = await reviewsCollection
          .find()
          .sort({ createdAt: -1 })
          .limit(6)
          .toArray();

        res.send(reviews);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch reviews" });
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
