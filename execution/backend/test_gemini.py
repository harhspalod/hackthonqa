import os
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
print(f"Key loaded: {api_key is not None}")

try:
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.5-flash")
    response = model.generate_content("Respond with a simple 'ok'")
    print(response.text)
except Exception as e:
    print(f"Error: {e}")
