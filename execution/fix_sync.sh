sed -i 's/async def generate_code/def generate_code/g' /home/ankit/Desktop/hackathon/backend/app/services/ai_service.py
sed -i 's/async def review_code/def review_code/g' /home/ankit/Desktop/hackathon/backend/app/services/ai_service.py
sed -i 's/await self.model.generate_content_async/self.model.generate_content/g' /home/ankit/Desktop/hackathon/backend/app/services/ai_service.py

sed -i 's/async def review/def review/g' /home/ankit/Desktop/hackathon/backend/app/services/review_engine.py
sed -i 's/await self.ai.review_code/self.ai.review_code/g' /home/ankit/Desktop/hackathon/backend/app/services/review_engine.py

sed -i 's/async def generate_code/def generate_code/g' /home/ankit/Desktop/hackathon/backend/app/routes/generate.py
sed -i 's/await ai.generate_code/ai.generate_code/g' /home/ankit/Desktop/hackathon/backend/app/routes/generate.py

sed -i 's/async def review_code/def review_code/g' /home/ankit/Desktop/hackathon/backend/app/routes/review.py
sed -i 's/await engine.review/engine.review/g' /home/ankit/Desktop/hackathon/backend/app/routes/review.py

sed -i 's/async def run_full_pipeline/def run_full_pipeline/g' /home/ankit/Desktop/hackathon/backend/app/routes/github_route.py
sed -i 's/await ai.generate_code/ai.generate_code/g' /home/ankit/Desktop/hackathon/backend/app/routes/github_route.py
sed -i 's/await review_engine.review/review_engine.review/g' /home/ankit/Desktop/hackathon/backend/app/routes/github_route.py
