import asyncio
import os
import google.generativeai as genai
from dotenv import load_dotenv

async def main():
    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY")
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.5-flash")
    print("Testing async generate_content_async...")
    try:
        response = await model.generate_content_async("Respond with 'async ok'")
        print("Response:", response.text)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(main())
