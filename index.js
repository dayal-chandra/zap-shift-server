const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

// MIDDLEWARE
app.use(cors());
app.use(express.json());

const uri = process.env.DB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const parcelCollection = client.db("parcelDB").collection("parcels");
    const usersCollection = client.db("parcelDB").collection("users");
    const paymentsCollection = client.db("parcelDB").collection("payments");
    const trackingCollection = client.db("parcelDB").collection("tracking");

    // Custom middleware
    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "unauthorized access." });
      }
      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "unauthorized access." });
      }
      next();
    };

    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const usersExists = await usersCollection.findOne({ email });
      if (usersExists) {
        return res
          .status(200)
          .send({ message: "User already exists", inserted: false });
      }
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // app.get("/parcels", async (req, res) => {
    //   const parcels = await parcelCollection.find().toArray();
    //   res.send(parcels);
    // });

    app.get("/parcels", async (req, res) => {
      try {
        const userEmail = req.query.email;
        const query = userEmail ? { created_by: userEmail } : {};
        const options = {
          sort: { createdAt: -1 },
        };

        const parcels = await parcelCollection.find(query, options).toArray();
        res.send(parcels);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).send({ message: "Failed to get parcel Data" });
      }
    });

    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!parcel) {
          return res.status(404).send({ message: "Parcel not found" });
        }
        res.send(parcel);
      } catch (error) {
        console.error("Error fetching parcel:", error);
        res.status(500).send({ message: "Failed to fetch parcel" });
      }
    });

    app.post("/parcels", async (req, res) => {
      const newParcel = req.body;
      const result = await parcelCollection.insertOne(newParcel);
      res.send(result);
    });

    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await parcelCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        console.error("Error deleting parcel", error);
        res.status(500).send({ message: "Failed to delete parcel" });
      }
    });

    // Payment API
    app.post("/create-payment-intent", async (req, res) => {
      const amountInCents = req.body.amountInCents;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/payments", verifyFBToken, async (req, res) => {
      console.log("Headers in payments", req.headers);
      try {
        const userEmail = req.query.email;
        const query = userEmail ? { email: userEmail } : {};
        const options = { sort: { paid_at: -1 } };
        const payments = await paymentsCollection
          .find(query, options)
          .toArray();
        res.send(payments);
      } catch (error) {
        console.error("Error fetching payment history", error);
        res.status(500).send({ message: "Failed to get payments." });
      }
    });

    app.post("/payments", async (req, res) => {
      try {
        const { parcelId, email, amount, paymentMethod, transactionId } =
          req.body;
        const updateResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              payment_status: "paid",
            },
          }
        );

        if (updateResult.modifiedCount === 0) {
          return res
            .status(400)
            .send({ message: "Parcel not found or already paid." });
        }

        const paymentDoc = {
          parcelId,
          email,
          amount,
          paymentMethod,
          transactionId,
          paid_at: new Date(),
          paid_at_string: new Date().toISOString,
        };

        const paymentResult = await paymentsCollection.insertOne(paymentDoc);

        res.status(201).send({
          message: "Payment recorded and parcel marked as paid.",
          insertedId: paymentResult.insertedId,
        });
      } catch (error) {
        console.error("Payment processing failed");
      }
    });

    // Tracking API
    app.post("/tracking", async (req, res) => {
      const {
        tracking_id,
        parcel_id,
        status,
        message,
        updated_by = "",
      } = req.body;
      const log = {
        tracking_id,
        parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
        status,
        message,
        time: new Date(),
        updated_by,
      };

      const result = await trackingCollection.insertOne(log);
      res.send({ success: true, insertedId: result.insertedId });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// SAMPLE ROUTE
app.get("/", (req, res) => {
  res.send("Zap-Shift is running");
});

app.listen(port, () => {
  console.log(`Zap-Shift server is running on port ${port}`);
});
