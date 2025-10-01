const express = require("express");
const app = express();
const mysql2 = require("mysql2");
const session = require("express-session");
const bcrypt = require("bcrypt"); // Add bcrypt for password hashing

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json());
app.set("view engine", "ejs");

// MySQL connection pool
const pool = mysql2.createPool({
  host: "localhost",
  user: "root",
  database: "shopping",
  password: "",
});

// Express session
app.use(
  session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false, // Changed to false for security
  })
);

// Middleware to check roles
function requireRole(role) {
  return (req, res, next) => {
    if (req.session.user && req.session.user.role === role) {
      return next();
    }
    return res.status(403).send("Access denied");
  };
}

// ROUTES

// Root
// Root
// Add this route near the top of your routes section in app.js, right after the root route

// Landing Page - Public route
app.get("/", async (req, res) => {
  try {
    // Get latest 4 products (sorted by ID descending to get newest)
    const [latestProducts] = await pool
      .promise()
      .query(
        "SELECT * FROM products WHERE quantity > 0 ORDER BY id DESC LIMIT 4"
      );

    // Get all products
    const [allProducts] = await pool
      .promise()
      .query("SELECT * FROM products ORDER BY id DESC");

    res.render("landing_page", {
      latestProducts,
      allProducts,
    });
  } catch (err) {
    console.error("Error loading landing page:", err);
    res.send("Error loading page");
  }
});

// Keep your existing routes below...
// app.get("/", (req, res) => {
//   res.send("Server is running!");
// });

// Registration with password hashing
app.get("/register", (req, res) => {
  res.render("register");
});

//Register part
app.post("/register", async (req, res) => {
  const { email, password, role } = req.body; // include role from form
  try {
    const [results] = await pool
      .promise()
      .query("SELECT * FROM users WHERE email=?", [email]);
    if (results.length) return res.send("Email already registered");

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.promise().query(
      "INSERT INTO users (email, password, role) VALUES (?, ?, ?)",
      [email, hashedPassword, role] // use the selected role
    );
    res.redirect("/login");
  } catch (err) {
    console.error("Insert error:", err);
    res.send("Error registering user");
  }
});

// LOGIN
app.get("/login", (req, res) => {
  res.render("login");
});
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const [results] = await pool
      .promise()
      .query("SELECT * FROM users WHERE email=?", [email]);
    if (!results.length) return res.send("User not found");

    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.send("Invalid password");

    req.session.user = user;

    if (user.role === "admin") return res.redirect("/admin/dashboard");
    if (user.role === "seller") return res.redirect("/seller/dashboard");
    if (user.role === "customer") return res.redirect("/customer/dashboard");

    res.send("Role not recognized");
  } catch (err) {
    res.send("DB error");
  }
});

// LOGOUT
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// ADMIN DASHBOARD
app.get("/admin/dashboard", requireRole("admin"), (req, res) => {
  res.render("admin_dashboard");
});
app.get("/admin/products", requireRole("admin"), (req, res) => {
  pool.query(
    "SELECT p.*, u.email AS seller_email FROM products p LEFT JOIN users u ON p.seller_id=u.id",
    (err, results) => {
      if (err) return res.send("Error fetching products");
      res.render("admin_products", { products: results });
    }
  );
});
app.get("/admin/orders", requireRole("admin"), (req, res) => {
  pool.query("SELECT * FROM orders", (err, results) => {
    if (err) return res.send("Error fetching orders");
    res.render("admin_orders", { orders: results });
  });
});

// Admin Add Product page
app.get(
  "/admin/products/admin_add_product",
  requireRole("admin"),
  async (req, res) => {
    try {
      // Get all users to allow selecting a seller
      const [users] = await pool
        .promise()
        .query("SELECT id, email, role FROM users");
      res.render("admin_add_product", { users }); // render EJS view
    } catch (err) {
      console.error(err);
      res.send("Error loading users");
    }
  }
);

// SELLER DASHBOARD
app.get("/seller/dashboard", requireRole("seller"), (req, res) => {
  res.render("seller_dashboard");
});
app.get("/seller/products", requireRole("seller"), (req, res) => {
  pool.query(
    "SELECT * FROM products WHERE seller_id=?",
    [req.session.user.id],
    (err, results) => {
      if (err) return res.send("Error fetching products");
      res.render("seller_products", { products: results });
    }
  );
});

//admin adding a product
app.post(
  "/admin/products/admin_add_product",
  requireRole("admin"),
  (req, res) => {
    const { name, price, quantity, seller_id } = req.body;

    pool.query(
      "INSERT INTO products (name, price, quantity, seller_id) VALUES (?, ?, ?, ?)",
      [name, price, quantity, seller_id],
      (err) => {
        if (err) return res.send("Error adding product: " + err.message);
        res.redirect("/admin/products"); // Redirect to the products list
      }
    );
  }
);
//admin add product then its get method
app.get(
  "/admin/products/admin_add_product",
  requireRole("admin"),
  async (req, res) => {
    try {
      const [users] = await pool
        .promise()
        .query("SELECT id, email, role FROM users");
      res.render("admin_add_product", { users }); // must pass { users }
    } catch (err) {
      console.error(err);
      res.send("Error loading users");
    }
  }
);
//Cart implementation
// CUSTOMER CHECKOUT
app.post(
  "/customer/cart/checkout",
  requireRole("customer"),
  async (req, res) => {
    if (!req.session.cart || req.session.cart.length === 0) {
      return res.send("Cart is empty");
    }

    const connection = await pool.promise().getConnection(); // get a connection
    try {
      await connection.beginTransaction();

      let totalPrice = 0;
      for (const item of req.session.cart) {
        const [productRows] = await connection.query(
          "SELECT * FROM products WHERE id = ? FOR UPDATE",
          [item.product_id]
        );

        if (!productRows.length || productRows[0].quantity < item.quantity) {
          throw new Error(
            "Insufficient stock for product ID: " + item.product_id
          );
        }

        totalPrice += productRows[0].price * item.quantity;
      }

      // Insert order first
      const [orderResult] = await connection.query(
        "INSERT INTO orders (customer_id, total, status) VALUES (?, ?, ?)",
        [req.session.user.id, totalPrice, "Pending"]
      );

      // Insert each product into order_items and update stock
      for (const item of req.session.cart) {
        const [productRows] = await connection.query(
          "SELECT * FROM products WHERE id = ?",
          [item.product_id]
        );

        await connection.query(
          "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
          [
            orderResult.insertId,
            item.product_id,
            item.quantity,
            productRows[0].price,
          ]
        );

        await connection.query(
          "UPDATE products SET quantity = quantity - ? WHERE id = ?",
          [item.quantity, item.product_id]
        );
      }

      await connection.commit();
      req.session.cart = [];
      res.redirect("/customer/orders?message=Order placed successfully");
    } catch (err) {
      await connection.rollback();
      res.send("Error placing order: " + err.message);
    } finally {
      connection.release();
    }
  }
);

app.get("/seller/orders", requireRole("seller"), (req, res) => {
  pool.query(
    "SELECT o.*, p.name FROM orders o JOIN products p ON o.product_id = p.id WHERE p.seller_id = ?",
    [req.session.user.id],
    (err, results) => {
      if (err) return res.send("Error fetching orders");
      res.render("seller_orders", { orders: results }); // Assuming a new seller_orders.ejs
    }
  );
});

// CUSTOMER DASHBOARD
app.get("/customer/dashboard", requireRole("customer"), (req, res) => {
  pool.query("SELECT * FROM products WHERE quantity > 0", (err, products) => {
    if (err) return res.send("Error loading products");
    res.render("customer_dashboard", { products, user: req.session.user });
  });
});

// CUSTOMER ORDERS
app.get("/customer/orders", requireRole("customer"), (req, res) => {
  const customerId = req.session.user.id;
  const message = req.query.message || null; // get success/error message

  pool.query(
    `SELECT o.id AS order_id, o.total, o.status, 
            oi.product_id, oi.quantity, oi.price, p.name AS product_name
     FROM orders o
     JOIN order_items oi ON o.id = oi.order_id
     JOIN products p ON oi.product_id = p.id
     WHERE o.customer_id = ?`,
    [customerId],
    (err, results) => {
      if (err) return res.send("Error fetching orders: " + err.message);

      // Group order items under their order
      const orders = {};
      results.forEach((row) => {
        if (!orders[row.order_id]) {
          orders[row.order_id] = {
            id: row.order_id,
            total: row.total,
            status: row.status,
            items: [],
          };
        }
        orders[row.order_id].items.push({
          product_id: row.product_id,
          name: row.product_name,
          quantity: row.quantity,
          price: row.price,
        });
      });

      // Pass grouped orders to EJS
      res.render("customer_orders", {
        orders: Object.values(orders),
        message,
      });
    }
  );
});
//to delete for a customer like orders
app.post("/customer/cart/remove", requireRole("customer"), (req, res) => {
  const { product_id } = req.body;
  if (!req.session.cart) req.session.cart = [];

  req.session.cart = req.session.cart.filter(
    (item) => item.product_id != product_id
  );

  res.redirect("/customer/cart");
});
//Update quantity of a cart item
app.post("/customer/cart/update", requireRole("customer"), (req, res) => {
  const { product_id, quantity } = req.body;
  if (!req.session.cart) req.session.cart = [];

  const itemIndex = req.session.cart.findIndex(
    (item) => item.product_id == product_id
  );
  if (itemIndex >= 0) {
    req.session.cart[itemIndex].quantity = parseInt(quantity);
  }

  res.redirect("/customer/cart");
});

// CUSTOMER CANCEL ORDER
app.post(
  "/customer/orders/cancel",
  requireRole("customer"),
  async (req, res) => {
    const { order_id } = req.body; // get the order ID from the form
    const connection = await pool.promise().getConnection();

    try {
      await connection.beginTransaction();

      // 1. Delete all items for this order first
      await connection.query("DELETE FROM order_items WHERE order_id = ?", [
        order_id,
      ]);

      // 2. Delete the order itself
      await connection.query("DELETE FROM orders WHERE id = ?", [order_id]);

      await connection.commit();
      res.redirect("/customer/orders?message=Order cancelled successfully");
    } catch (err) {
      await connection.rollback();
      res.send("Error cancelling order: " + err.message);
    } finally {
      connection.release();
    }
  }
);

// Customer Cart - Store cart items in session
app.post("/customer/cart/add", requireRole("customer"), (req, res) => {
  const { product_id, quantity } = req.body;
  if (!req.session.cart) req.session.cart = [];
  const existsIndex = req.session.cart.findIndex(
    (item) => item.product_id == product_id
  );
  if (existsIndex >= 0) {
    req.session.cart[existsIndex].quantity += parseInt(quantity);
  } else {
    req.session.cart.push({
      product_id: parseInt(product_id),
      quantity: parseInt(quantity),
    });
  }
  res.redirect("/customer/cart");
});

app.get("/customer/cart", requireRole("customer"), (req, res) => {
  if (!req.session.cart || req.session.cart.length === 0) {
    return res.render("customer_cart", {
      products: [],
      message: "Cart is empty",
    });
  }
  const ids = req.session.cart.map((item) => item.product_id);
  pool.query(
    `SELECT * FROM products WHERE id IN (${ids.join(",")})`,
    (err, products) => {
      if (err) return res.send("Error loading cart products");
      const cartProducts = products.map((prod) => {
        const item = req.session.cart.find((i) => i.product_id === prod.id);
        return { ...prod, quantity_in_cart: item.quantity };
      });
      res.render("customer_cart", { products: cartProducts, message: null });
    }
  );
});

//seller product add route:
// Seller Add Product page
app.get("/seller/products/add", requireRole("seller"), async (req, res) => {
  res.render("seller_add_product"); // Create this EJS view
});

// Seller Add Product POST
app.post("/seller/products/add", requireRole("seller"), (req, res) => {
  const { name, price, quantity } = req.body;
  const seller_id = req.session.user.id;

  pool.query(
    "INSERT INTO products (name, price, quantity, seller_id) VALUES (?, ?, ?, ?)",
    [name, price, quantity, seller_id],
    (err) => {
      if (err) return res.send("Error adding product: " + err.message);
      res.redirect("/seller/products");
    }
  );
});

// Seller can see orders for their products
app.get("/seller/orders", requireRole("seller"), (req, res) => {
  const sellerId = req.session.user.id;

  pool.query(
    `SELECT o.id AS order_id, o.total, o.status, oi.product_id, oi.quantity, oi.price, p.name
     FROM orders o
     JOIN order_items oi ON o.id = oi.order_id
     JOIN products p ON oi.product_id = p.id
     WHERE p.seller_id = ?`,
    [sellerId],
    (err, results) => {
      if (err) return res.send("Error fetching orders: " + err.message);

      // Group items by order
      const orders = {};
      results.forEach((row) => {
        if (!orders[row.order_id]) {
          orders[row.order_id] = {
            id: row.order_id,
            total: row.total,
            status: row.status,
            items: [],
          };
        }
        orders[row.order_id].items.push({
          product_id: row.product_id,
          name: row.name,
          quantity: row.quantity,
          price: row.price,
        });
      });

      res.render("seller_orders", { orders: Object.values(orders) });
    }
  );
});

// SERVER
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server runnin at: http://localhost:${PORT}`);
});
