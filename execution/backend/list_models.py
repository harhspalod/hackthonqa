import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
try:
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    print("Models available:")
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            print("- " + m.name.replace('models/', ''))
except Exception as e:
    print("Error:", e)
