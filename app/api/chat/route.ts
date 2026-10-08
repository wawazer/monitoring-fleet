import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request: Request) {

  try {

    const { message } = await request.json();

    const genAI = new GoogleGenerativeAI(
      process.env.GEMINI_API_KEY!
    );


    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash"
    });


    const result = await model.generateContent(message);

    const response = result.response.text();


    return Response.json({
      success:true,
      reply:response
    });


  } catch(error){

    return Response.json({
      success:false,
      error:
        error instanceof Error
        ? error.message
        : String(error)
    },{
      status:500
    });

  }

}