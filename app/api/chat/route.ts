import { GoogleGenerativeAI } from "@google/generative-ai";


const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY!
);


export async function POST(request:Request){

  try{


    const body = await request.json();


    const question = body.message;


    if(!question){

      return Response.json({

        success:false,

        message:"Pertanyaan kosong"

      });

    }



    const model =
      genAI.getGenerativeModel({
        model:"gemini-1.5-flash"
      });



    const prompt = `

Kamu adalah AI Fleet Assistant untuk sistem P-CAR.

Jawab pertanyaan pengguna mengenai:
- ketersediaan kendaraan
- booking kendaraan
- status armada
- driver


Pertanyaan user:

${question}

`;



    const result =
      await model.generateContent(prompt);



    const answer =
      result.response.text();



    return Response.json({

      success:true,

      answer:answer

    });



  }catch(error){


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