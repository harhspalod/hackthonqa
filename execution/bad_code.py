import sqlite3
import hashlib
def login_user(username, password):
    # SECURITY: Use parameterized queries to prevent SQL Injection
    conn = sqlite3.connect("database.db")
    query = "SELECT * FROM users WHERE username = ? AND password = ?"
    cursor = conn.cursor()
    cursor.execute(query, (username, password))
    user = cursor.fetchone()
    if user is None:
        print("Invalid login")
        return None
    else:
        print(f"Logged in user: {user[0]}")
        return user
def process_data(data_list):
    # PERFORMANCE: Use list comprehension for efficient concatenation
    result = [item * 2 for item in data_list]
    print("Done processing")
    try:
        divisor = 0
        val = 10 / divisor
    except ZeroDivisionError as e:
        print(f"Error: {e}")
    return result
def do_something(param1, param2=None):
    # READABILITY: Use meaningful variable names
    a = param1
    b = 5
    c = a + b
    if param2 is not None and len(param2) > 0:
        c += 1
    return c