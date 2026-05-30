import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
    interface Session {
        user: {
            id:             string;
            email:          string;
            name:           string;
            firstName:      string;
            lastName:       string;
            role:           string;
            group:          string;
            employeeNumber: string;
            position:       string;
            phone:          string;
        };
    }
    interface User {
        id:             string;
        role:           string;
        firstName:      string;
        lastName:       string;
        group:          string;
        employeeNumber: string;
        position:       string;
        phone:          string;
    }
}

declare module 'next-auth/jwt' {
    interface JWT {
        id:             string;
        role:           string;
        firstName:      string;
        lastName:       string;
        group:          string;
        employeeNumber: string;
        position:       string;
        phone:          string;
    }
}
